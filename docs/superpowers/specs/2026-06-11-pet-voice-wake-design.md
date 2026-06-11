# 宠物离线语音唤醒 + 可配转写 — 设计文档

- 日期：2026-06-11
- 状态：待评审（评审第 2 版，已修订单流架构 / 投递机制）
- 作者：Danovan / Claude
- 涉及仓库：`digital-employe-client-web-main`（Electron + React 桌面端，`apps/web`）

## 1. 背景与目标

桌面端有一只"宠物"（`apps/web/src/components/pet`）。当前已有**点击说话**链路：点宠物 → 录音 → 上传转写服务（Finch）→ 文字发给"总管"对话。

目标：让宠物**常驻监听本地唤醒词「你好博般」**，命中后**免手**完成"录音 → 转写 → 发对话"，并让转写后端可在运行时配置，使**纯离线一体机**也能用（指向本机部署的 STT 服务）。

成功标准：
- 在装有唤醒模型的机器上，对宠物说"你好博般"后接着说一句话，宠物自动挥手录音、说完自动转写并发给总管，全程不点鼠标。
- 未部署唤醒模型时，功能静默关闭，现有点击说话不受影响。
- 离线一体机把转写地址指向本机 STT 服务即可端到端工作，无需联网、无需改代码重新打包。

## 2. 范围

本设计含两个子系统，**合并为一个 spec**一起实现：

- **A｜唤醒词检测（KWS）+ 唤醒反馈**：sherpa-onnx WebAssembly 检测「你好博般」→ 宠物播放**预录反馈片段**「我在，有什么可以为你效劳」→ 触发现有录音免手链路。
- **B｜转写后端运行时可配**：把转写服务地址/密钥/语言从**构建期** Vite 环境变量改为**运行时**配置（electron-store），缺省回退现有值。

### 非目标（本次不做）

- 不在客户端内嵌离线 ASR 模型/推理（离线机的转写由**本机部署的 STT 服务**承担，属运维范畴；客户端只需把地址指过去）。
- **不引入 TTS 引擎**：唤醒反馈是**固定一句的预录音频片段**；动态反馈文本（需 TTS）为后续。
- **自定义唤醒词为后续规划**：本期唤醒词固定「你好博般」，经模型 `keywords.txt` 配置；不做多唤醒词管理 UI。
- 不改动总管对话/Agent 链路（沿用 `sendCuratorStreamMessage`）。
- 不做声纹/说话人识别。

## 3. 术语

| 缩写 | 全称 | 职责 |
|---|---|---|
| KWS | Keyword Spotting | 判断"是否听到口令"，本地常驻、低延迟 |
| ASR / STT | Automatic Speech Recognition / Speech-to-Text | 把整段语音转成文字（Finch 即一个 ASR 服务） |
| VAD | Voice Activity Detection | 判断"是否在说话"，用于检测说完（尾静音端点） |

## 4. 现状（复用基础）

- 宠物渲染与动画：`apps/web/src/components/pet/PetWindow.tsx`、`animation/SpritePlayer.tsx`、`animation/types.ts`。
  - 录音时 `isRecording → "waving"`（挥手，`PetWindow.tsx:126`）；处理中 `voiceBusy → "waiting"`（思考，`PetWindow.tsx:124`）。这正是"录音动作"。
- 语音 Hook：`apps/web/src/components/pet/use-pet-voice-curator.ts`
  - 现状对外仅暴露 `toggleVoiceClick()`、`isRecording`、`voiceBusy`、`feedback`、`clearFeedback`。
  - **内部**：`startRecording()` 自己 `getUserMedia` 建 `streamRef` + MediaRecorder；`finishRecordingAndSend()` 停录→`transcribePetAudio`→`sendCuratorStreamMessage`；`cleanupStream()` 会 `stop()` 自有轨。
  - ⚠️ 关键约束：该 Hook **自持私有麦克风流**，当前**无法注入外部流**——本设计需对它做受控改造（见 §6.1）。
- 转写：`apps/web/src/lib/pet/transcribe-audio.ts` → Finch，默认 `http://192.168.2.125:8082/finch/v1/audio/transcriptions`，**构建期** env `VITE_FINCH_TRANSCRIPTION_URL/_KEY/_LANGUAGE`（`import.meta.env` 编译期内联，运行时不可改）。
- 发送：`apps/web/src/lib/pet/send-curator-stream.ts` → `sendCuratorStreamMessage(text, { conversationId })`。
- 宠物窗与 IPC：`electron/features/pet/pet-window.ts`
  - 生产用 `file://…/dist/index.html#/pet` 加载；窗口有独立 `persist:pet-panel` partition 且**自动授予媒体权限**（不再弹权限框）。
  - 已有**自定义协议处理**先例：`handlePetdexRequest`（`petdex://`）用于读取磁盘上的宠物资源——本设计的模型字节投递将**复刻此先例**（见 §6.3）。
- 设置存储：`electron/features/settings/settings-store.ts`（electron-store，`~/.digital-employee/settings.json`，`getSetting/setSetting`）。
  - ⚠️ `electron/features/pet/ipc.ts` 的 `getPetSettings` 返回**固定 3 字段**、`setPetSettings` 仅白名单 `petEnabled/petVisibilityMode/petAlwaysOnTop`；新增字段若不扩白名单会被**静默丢弃**（见 §8.2）。
- 离线资源路径范式：`electron/features/backend/backend-process.ts` 的 `OFFLINE_DEPS_DIR`。
- 打包：`apps/web/electron-builder.json5` —— 有 `extraResources`，**无 `asarUnpack`**；`files: ["dist", ...]`。无 AudioWorklet 先例。

## 5. 架构总览（单条共享麦克风流）

核心决策：**`useWakeWord` 独占持有一条持久麦克风流**；该流同时供给 (1) AudioWorklet→KWS/VAD，(2) 命中后录音的 MediaRecorder。录音不再新开流，而是**复用同一条**（需改造 Hook 接受注入流，§6.1）。这样 VAD 与录音是**同一路音频**，且全程只有一次设备捕获（无双流回声/AGC 冲突）。

```
┌──────────────── 宠物渲染进程 (file://…/pet) ─────────────────────┐
│                                                                  │
│  useWakeWord 持久流 = getUserMedia(audio)                         │
│        │                                                         │
│        ├─► AudioContext.MediaStreamSource ─► AudioWorklet         │
│        │        (pcm-worklet: → 16kHz mono f32 帧)                │
│        │                 │                                       │
│        │                 ├─► KWS.accept(f32) → poll()            │
│        │                 │      命中"你好博般"(capture 外才采纳)    │
│        │                 │            │                          │
│        │                 └─► VAD.accept(f32) → isEndpoint()      │
│        │                          (仅 capture 期间判端点)          │
│        │                                                         │
│        └─► (同一条流注入) MediaRecorder ◄── startRecording(stream)│
│                                                                  │
│   onWake → voice.startRecording({stream}) [挥手] → capture=on    │
│   VAD 端点 → voice.finishRecordingAndSend() → 转写 → 发总管        │
│              (停 MediaRecorder，但不停共享流的轨)                  │
│   完成 → capture=off → 恢复采纳 KWS 命中                          │
│                                                                  │
│   模型字节：wakemodel:// 协议(主进程)流式读 ~/.digital-employee/… │
│   wasm/worklet 资产：public/ 内随 dist 发，相对 index.html 加载    │
└──────────────────────────────────────────────────────────────────┘
```

**喂帧 vs 采纳分离**（解决"暂停喂 KWS"与 VAD 的矛盾）：capture 期间**继续喂波形**给 wasm（VAD 端点要用），但**忽略 KWS 关键词命中**（`capture=on` 时 `poll()` 结果不触发 onWake），从而既不自触发、又能端点。

## 6. 组件设计

### 6.1 A — 唤醒词模块（新增）+ Hook 受控改造

目录：`apps/web/src/lib/pet/wake/`

| 文件 | 职责 | 对外接口 |
|---|---|---|
| `pcm-worklet.ts` | AudioWorklet 处理器：麦克风音频 → 16kHz 单声道 Float32 帧，`port.postMessage` | worklet 模块（`public/` 资产，相对 URL 加载） |
| `sherpa-kws.ts` | 封装 sherpa-onnx wasm：经 `locateFile` 定位 `public/` 内 wasm；用 §6.3 协议把模型字节写入 wasm MEMFS；`createKeywordSpotter` + `createVad`；`accept(f32)`、`pollKeyword()`、`vadIsEndpoint()`、`free()` | `createSherpa(modelUrlBase): Promise<{accept, pollKeyword, vadIsEndpoint, vadReset, free}>` |
| `resolve-wake-model.ts` | 经 IPC 取模型存在性与协议基址 | `resolveWakeModel(): Promise<{present, urlBase}>` |
| `useWakeWord.ts` | Hook：持久流 + AudioContext + worklet + sherpa 生命周期；`enabled` 启停；`capture` 门控；命中防抖；VAD 端点回调 | `useWakeWord({ enabled, onWake, onEndpoint }): { active, status, getStream(): MediaStream \| null }` —— `getStream` 在权限/AudioContext 就绪前可能为 `null` |

**`usePetVoiceCurator` 受控改造（API 确有变化）**：
- `startRecording(opts?: { stream?: MediaStream })`：传入 `stream` 时复用该流建 MediaRecorder，并记 `externalStream=true`；否则保持现状自开流（点击说话不受影响）。
- `cleanupStream()`：`externalStream` 为真时**只置空 ref、不 `stop()` 轨**（所有权归 `useWakeWord`）。
- 返回值新增暴露 `startRecording`、`finishRecordingAndSend`（供唤醒驱动直接调"开/停"两端，而非只有 toggle）。
- 现有 `toggleVoiceClick` 行为与签名不变（点击说话回归路径不动）。

接入 `PetWindow.tsx`：
```ts
const voice = usePetVoiceCurator()
const wake = useWakeWord({
  enabled: voiceWakeEnabled && modelPresent && !voice.voiceBusy,
  onWake: async () => {
    const stream = wake.getStream()          // 可能为 null（权限/AudioContext 未就绪）
    if (!stream) return
    await voice.startRecording({ stream })   // capture=on，宠物挥手
  },
  onEndpoint: () => voice.finishRecordingAndSend(), // VAD 端点 → 停录发送，capture=off
})
```
端点驱动由 `useWakeWord` 内部 VAD 触发：capture 期间检测到端点 → 调用传入的 `onEndpoint`（即 `voice.finishRecordingAndSend`）。开录设**最长时长兜底**（如 15s），VAD 异常也能收尾。

### 6.2 B — 转写后端运行时可配

- `SettingsData` 增 `transcriptionUrl/transcriptionKey/transcriptionLanguage`（§8.2）。
- 新增 IPC `settings:get-transcription-config` + bridge `getTranscriptionConfig(): Promise<{url,key,language}>`（pet 窗 preload 复用共享 `electronApi`，已注入）。
- `transcribe-audio.ts` 改为 `await window.electronApi.getTranscriptionConfig()`，**读取顺序：运行时设置 > `VITE_FINCH_*` > 内置默认**；`transcribePetAudio` 改为先 await 配置再发请求（函数本就 async，无破坏）。请求体/响应解析逻辑不变。

### 6.3 模型字节投递（解决 file:// 下渲染进程读外部磁盘）

渲染进程在 `file://` 下**不能** `fetch` 应用包外的绝对磁盘路径，故模型字节必须经主进程跨界投递。**复刻现有 `petdex://` 先例**，在 pet 窗 session 注册 `wakemodel://` 协议：
- 主进程 `electron/features/pet/wake-model.ts`：解析模型目录（`WAKEWORD_MODEL_DIR` env > 设置 `wakeModelDir` > 默认 `~/.digital-employee/models/wake/`），校验 §8.1 的**运行时必需文件集**齐全 → `present`。
- 注册 `wakemodel://<file>` → 流式返回该目录下文件字节（仅限白名单文件名，防穿越）。
- IPC `wake:resolve-model` 返回 `{ present, urlBase: "wakemodel://" }`。
- `sherpa-kws.ts` 用 `urlBase + 文件名` 拉取字节写入 wasm MEMFS，再 `createKeywordSpotter`/`createVad`。

> wasm 胶水 `.js/.wasm` 放 `public/`（随 `dist` 发，相对 index.html 可加载）；**模型不入包**走上述协议。两者分离避免 `extraResources` 落在渲染不可加载源的问题。

### 6.4 唤醒反馈片段（预录音频，无 TTS）

- 资产：默认 `apps/web/public/wake/feedback.mp3`（固定「我在，有什么可以为你效劳」，随 `dist` 发）；若模型目录存在 `feedback.wav` 则**优先用**（经 `wakemodel://feedback.wav` 投递，便于一体机换声不重打包）。`feedback` 为**可选**文件，不在 §8.1 必需文件集内。
- 播放：`useWakeWord` 内持有一个预解码的音频元素；`onWake` 时 `play()`，`onended` 驱动进入录音阶段。
- 与录音**串行**（先播完再开录）：天然避免反馈声被麦克风录入造成回声/误识别。加载失败 / 无输出设备 / 超时兜底（如 3s）→ 跳过反馈直接开录，不阻断主链路。

## 7. 数据流（关键时序）

1. 启用且 `present` → `useWakeWord` 开持久流 + AudioContext + worklet；`createSherpa(urlBase)`（MEMFS 载模型）；预解码反馈片段。
2. worklet 持续输出 16k PCM → `accept(frame)`；`capture=off` 时 `pollKeyword()` 生效。
3. 命中「你好博般」→ 防抖去重 → `onWake()`。
4. `onWake`：`capture=on`、宠物 "waving"；**先播反馈片段**「我在，有什么可以为你效劳」；播放期间继续喂波形但忽略 KWS 命中、**暂不判端点**（防把反馈声当用户话）。
5. 反馈 `onended`（或加载失败/无设备/超时即跳过）→ `voice.startRecording({ stream })`（复用共享流，`isRecording=true`）→ 启 VAD 端点。
6. 用户说话 → VAD 端点（尾静音）→ `voice.finishRecordingAndSend()`：停 MediaRecorder（**不停共享流轨**）→ `transcribePetAudio`(运行时配置) → `sendCuratorStreamMessage` → 成功气泡。
7. 发送结束（成功/失败）→ `vadReset()`、`capture=off`，恢复采纳 KWS 命中。

## 8. 模型、唤醒词与配置

### 8.1 模型与唤醒词
- 模型：`sherpa-onnx-kws-zipformer-wenetspeech-3.3M`（encoder/decoder/joiner.onnx、tokens.txt、bpe.model）+ silero-VAD（`silero_vad.onnx`，同 wasm 体系）。
- 唤醒词：`sherpa-onnx-cli text2token`（用 `bpe.model`）把「你好博般」（拼音）转 token 写入 `keywords.txt`，附触发阈值 `#`（必要时提升分 `:`）。阈值现场调（误唤醒 vs 漏唤醒）。
- **运行时必需文件集（`present` 判定，§6.3 引用此处为准）**：`encoder.onnx`、`decoder.onnx`、`joiner.onnx`、`tokens.txt`、`keywords.txt`、`silero_vad.onnx`。`bpe.model` 仅部署期 `text2token` 生成 `keywords.txt` 时用，**运行时非必需**。
- 部署：模型目录由一体机/运维**自部署**，不进安装包。解析优先级见 §6.3；缺任一必需文件 → `present=false`。

### 8.2 设置（exact 改动清单）
新增 `SettingsData` 字段及默认（**两处 defaults 都要加**）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `voiceWakeEnabled` | `true` | 唤醒总开关（默认开） |
| `wakeModelDir` | `""` | 模型目录覆盖（空=默认解析） |
| `transcriptionUrl` | `""` | 转写地址（空=回退 env） |
| `transcriptionKey` | `""` | 转写密钥（空=回退 env） |
| `transcriptionLanguage` | `""` | 语言（空=回退 env/`zh`） |

需协同改动的文件（避免"设置存不进"的坑）：
1. `settings-store.ts`：`SettingsData` 接口 + `defaults`。
2. **新增**专用读写通道，不复用受限的 `getPetSettings`：
   - IPC `wake:get-settings` / `wake:set-settings`（含上述 5 字段白名单）+ `settings:get-transcription-config`。
   - `preload-bridge.ts` 增对应方法与类型。
3. 设置页（`pet-settings.tsx` 或新增"语音"分区）：唤醒开关、模型目录、转写地址/密钥/语言。

## 9. 打包

- sherpa-onnx **KWS+VAD wasm 资产**与 `pcm-worklet`：放 `apps/web/public/wake/`，随 `dist` 发布，运行时以**相对 index.html** 的 URL 加载（`audioWorklet.addModule`、wasm `locateFile`）。需在 PoC 验证 `file://` 下解析正常。
- **默认反馈片段** `apps/web/public/wake/feedback.mp3` 随 `dist` 发；一体机可在模型目录放 `feedback.wav` 覆盖（§6.4）。
- **模型不进包**，经 `wakemodel://`（§6.3）投递；外部自部署。
- **不引入原生 `.node`，不需要 `asarUnpack`**。
- 在线包可不带模型（功能自动关闭）；离线包随机部署模型 + 本机 STT 地址。

## 10. 边界与错误处理

| 场景 | 行为 |
|---|---|
| 无麦克风权限 / 无设备 | 唤醒静默关闭；首次复用 `getMicErrorCopy` 提示一次；点击说话仍可用 |
| 模型缺失/不全 | `present=false`，唤醒不启动，无报错噪音 |
| wasm/worklet 加载或 MEMFS 失败 | 记录日志 + 关闭唤醒，降级点击说话 |
| 反馈片段缺失/解码失败/无输出设备/超时 | 跳过反馈，直接开录（不阻断主链路） |
| capture 期间又命中关键词 | `capture=on` 时 `pollKeyword` 结果被忽略；另加去重防抖 |
| VAD 不收敛 | 最长录音时长兜底停录 |
| 转写地址未配且 env 缺失 | 复用现有错误气泡（"识别或发送失败"） |
| 禁用/卸载/组件卸载 | 停 worklet、停**共享流**轨、`free()` 释放 wasm、关 AudioContext |

> 单流设计下全程只有一次设备捕获，无双 `getUserMedia` 并发/回声问题。

## 11. 测试计划

单元测试（vitest）：
- `resolve-wake-model`：文件齐/缺/目录无 → `present` 判定。
- 唤醒接线：mock `usePetVoiceCurator`，`onWake`→**先播反馈、`onended` 后**才 `startRecording({stream})`；VAD 端点→`finishRecordingAndSend`（调用次数/顺序/参数）。
- 反馈缺失/解码失败 → 跳过反馈、直接 `startRecording`（不阻断）。
- capture 门控：`capture=on` 时 `pollKeyword` 命中不触发 `onWake`。
- VAD 端点：给定静音段 → `vadIsEndpoint()` 为真。
- `pcm-worklet` 降采样：输入采样率 → 16k 帧长/值正确。
- `transcribe-audio` 配置回退：运行时设置 > env > 默认。
- Hook 改造：`startRecording({stream})` 不 `stop()` 外部轨；无参时仍自开流。

手动测试：
- 部署模型 → 说"你好博般" → 听到"我在，有什么可以为你效劳" → 说一句 → 自动转写发总管。
- 无模型 → 唤醒关闭，点击说话照常。
- 拒绝麦克风 → 优雅降级、提示一次。
- 离线机把 `transcriptionUrl` 指本机 STT → 端到端无外网可用。
- `file://` 生产包：worklet/wasm 能加载、`wakemodel://` 能取模型。

## 12. 风险与未决

- **误唤醒率**：常驻 KWS 必有误触发，靠 `keywords.txt` 阈值/提升分现场调。
- **WASM 资产/模型在 `file://` 下加载（最大未知）**：`audioWorklet.addModule` 相对 URL、wasm `locateFile`、`wakemodel://` 字节注入 MEMFS —— 三者均须在 §13 **PoC 阶段**先打通（不是关键词识别本身）。
- **常驻麦克风**：一体机/kiosk 可接受；是否随宠物可见性收放留作 v1 后可选优化（v1 仅 `voiceWakeEnabled` 控制）。
- **本机 STT 服务**：部署与 Finch 兼容接口（`/v1/audio/transcriptions`）由运维保证，客户端只对接地址。

## 13. 实现顺序（里程碑）

1. **B（转写运行时可配）**：`SettingsData` + 默认 + `settings:get-transcription-config` + bridge + `transcribe-audio` 改造 + 设置页。小、独立、先落，点击说话即受益。
2. **A-PoC（打通三处投递，最大风险前置）**：`public/` 放 wasm+worklet；`wakemodel://` 协议；MEMFS 载模型；命中即 `log`。在 dev 与 `file://` 生产包**双环境验证**资产加载与字节注入。
3. **A 主体**：`useWakeWord` + worklet + `resolve-wake-model` IPC + Hook 注入流改造 + 接入 `PetWindow` + VAD 端点 + capture 门控 + **反馈片段串行播放**（`public/wake/feedback.mp3`，模型目录 `feedback.wav` 覆盖）。
4. 设置页唤醒开关/模型目录、边界降级、打包 `public/wake` 资产。
5. 测试（单元 + 手动）+ 阈值调参。
