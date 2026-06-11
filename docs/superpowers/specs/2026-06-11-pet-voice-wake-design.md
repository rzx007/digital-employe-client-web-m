# 宠物离线语音唤醒 + 可配转写 — 设计文档

- 日期：2026-06-11
- 状态：待评审
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

- **A｜唤醒词检测（KWS）**：sherpa-onnx WebAssembly，跑在宠物渲染进程，检测「你好博般」→ 触发现有录音免手链路。
- **B｜转写后端运行时可配**：把转写服务地址/密钥/语言从**构建期** Vite 环境变量改为**运行时**配置（electron-store），缺省回退现有值。

### 非目标（本次不做）

- 不在客户端内嵌离线 ASR 模型/推理（离线机的转写由**本机部署的 STT 服务**承担，属运维范畴；客户端只需把地址指过去）。
- 不改动总管对话/Agent 链路（沿用 `sendCuratorStreamMessage`）。
- 不做声纹/说话人识别、不做多唤醒词管理 UI（唤醒词固定为「你好博般」，经模型 `keywords.txt` 配置）。

## 3. 术语

| 缩写 | 全称 | 职责 |
|---|---|---|
| KWS | Keyword Spotting | 判断"是否听到口令"，本地常驻、低延迟 |
| ASR / STT | Automatic Speech Recognition / Speech-to-Text | 把整段语音转成文字（Finch 即一个 ASR 服务） |
| VAD | Voice Activity Detection | 判断"是否在说话"，用于检测说完（尾静音端点） |

## 4. 现状（复用基础）

- 宠物渲染与动画：`apps/web/src/components/pet/PetWindow.tsx`、`animation/SpritePlayer.tsx`、`animation/types.ts`。
  - 录音时状态 `isRecording → "waving"`（挥手）；处理中 `voiceBusy → "waiting"`（思考）。这正是"录音动作"。
- 语音 Hook：`apps/web/src/components/pet/use-pet-voice-curator.ts`
  - 暴露 `toggleVoiceClick()`：idle 时**开始录音**，recording 时**停录+转写+发送**；以及 `isRecording`、`voiceBusy`、`feedback`、`clearFeedback`。
  - 内部 `startRecording()`（getUserMedia + MediaRecorder/WebM-Opus）、`finishRecordingAndSend()`（停录 → `transcribePetAudio` → `sendCuratorStreamMessage`）。
- 转写：`apps/web/src/lib/pet/transcribe-audio.ts` → Finch，默认 `http://192.168.2.125:8082/finch/v1/audio/transcriptions`，**构建期** env `VITE_FINCH_TRANSCRIPTION_URL/_KEY/_LANGUAGE`。
- 发送：`apps/web/src/lib/pet/send-curator-stream.ts` → `sendCuratorStreamMessage(text, { conversationId })`。
- 宠物窗与 IPC：`electron/features/pet/pet-window.ts`（**已为窗口设置媒体权限 partition**）、`electron/features/pet/ipc.ts`（`petShow` 等）、`preload-bridge.ts`（`petBridge`）。
- 设置存储：`electron/features/settings/settings-store.ts`（electron-store，`~/.digital-employee/settings.json`，`getSetting/setSetting`）。
- 离线资源路径范式：`electron/features/backend/backend-process.ts` 的 `OFFLINE_DEPS_DIR`（注入子进程）；模型/二进制走 `electron-builder.json5` 的 `extraResources`。
- 打包：`apps/web/electron-builder.json5` —— 有 `extraResources`，**无 `asarUnpack`**。

## 5. 架构总览

```
┌──────────────── 宠物渲染进程 (apps/web renderer) ────────────────┐
│                                                                  │
│  麦克风(getUserMedia, 持久流)                                     │
│        │                                                         │
│        ├─► AudioWorklet(pcm-worklet) ─16kHz mono f32─► KWS(wasm) │
│        │                                   │                     │
│        │                              命中"你好博般"               │
│        │                                   ▼                     │
│        │                         useWakeWord.onWake()           │
│        │                                   │                     │
│        │           ┌───────────────────────┘                     │
│        │           ▼                                             │
│        │   usePetVoiceCurator.toggleVoiceClick() ── 开录(挥手)    │
│        │           │                                             │
│        └─► VAD(尾静音端点) ──说完──► toggleVoiceClick() ── 停录    │
│                                          │                       │
│                                  finishRecordingAndSend()        │
│                                          │                       │
│                              transcribePetAudio(可配URL) ──HTTP──►│ STT 服务
│                                          │                       │ (Finch / 本机)
│                                  sendCuratorStreamMessage ──────►│ 总管对话
└──────────────────────────────────────────────────────────────────┘

模型/wasm 资产解析：Electron 主进程 IPC `wake:resolve-model`
  → 查 WAKEWORD_MODEL_DIR(env) / settings / 默认 ~/.digital-employee/models/wake/
  → 返回 {dir, present}
```

## 6. 组件设计

### 6.1 A — 唤醒词模块（新增）

目录：`apps/web/src/lib/pet/wake/`

| 文件 | 职责 | 对外接口 |
|---|---|---|
| `pcm-worklet.ts` | AudioWorklet 处理器：把麦克风音频重采样为 16kHz 单声道 Float32 帧，`postMessage` 给主线程 | worklet 模块 URL |
| `sherpa-kws.ts` | 封装 sherpa-onnx wasm：加载 wasm + 模型、`createKeywordSpotter`、`acceptWaveform`、轮询 `getResult`；同 wasm 内的 VAD 端点封装 | `createKws(modelDir): { accept(f32), poll(): string\|null, vadIsEndpoint(): bool, free() }` |
| `resolve-wake-model.ts` | 经 IPC 取模型目录与存在性 | `resolveWakeModel(): Promise<{dir, present}>` |
| `useWakeWord.ts` | React Hook：持久麦克风流 + worklet + KWS 生命周期；`enabled` 控制启停；防抖；录音期间暂停喂帧 | `useWakeWord({ enabled, onWake }): { active, status }` |

接入：`PetWindow.tsx` 中
```ts
const voice = usePetVoiceCurator()
const wake = useWakeWord({
  enabled: voiceWakeEnabled && modelPresent && !voice.voiceBusy,
  onWake: () => handleWake(voice),
})
```
`handleWake`：若空闲 → `voice.toggleVoiceClick()` 开录；订阅 VAD 端点（说完）→ 再 `voice.toggleVoiceClick()` 停录发送。开录后**暂停向 KWS 喂帧**（防自触发/回声），发送完成或失败后恢复。

> 说明：复用 `toggleVoiceClick` 的"开/停"语义即可，无需改动 `usePetVoiceCurator` 的对外 API；VAD 端点驱动"停"这一下，替代人手点击。

### 6.2 B — 转写后端运行时可配

- 新增运行时配置来源（electron-store，见 §8），字段：`transcriptionUrl`、`transcriptionKey`、`transcriptionLanguage`。
- 改 `transcribe-audio.ts`：读取顺序 **运行时设置 > `VITE_FINCH_*`（向后兼容）> 内置默认**。通过 preload bridge 暴露 `getTranscriptionConfig()` 给渲染进程（同步或启动时拉取缓存）。
- 不改请求体/响应解析逻辑（仍是 OpenAI Whisper 风格 multipart）。

## 7. 数据流（关键时序）

1. 启用且模型存在 → `useWakeWord` 开持久麦克风流 + worklet + KWS。
2. worklet 持续输出 16k PCM → `kws.accept(frame)` → `kws.poll()`。
3. `poll()` 返回「你好博般」→ 防抖去重 → `onWake()`。
4. `onWake`：`toggleVoiceClick()` 开录（`isRecording=true` → 宠物 "waving"）；暂停喂 KWS；开始 VAD 端点检测（基于同一路 PCM）。
5. 用户说话 → VAD 检测到尾静音（端点）→ `toggleVoiceClick()` 停录 → `finishRecordingAndSend()`：停 MediaRecorder → `transcribePetAudio`(可配URL) → `sendCuratorStreamMessage` → 成功气泡。
6. 发送结束（成功/失败）→ 恢复向 KWS 喂帧，回到监听态。

边界超时：开录后设**最长录音时长**（如 15s）兜底，VAD 异常也能收尾。

## 8. 模型、唤醒词与配置

### 8.1 模型与唤醒词
- 模型：`sherpa-onnx-kws-zipformer-wenetspeech-3.3M`（含 encoder/decoder/joiner.onnx、tokens.txt、bpe.model）。
- 唤醒词：用 `sherpa-onnx-cli text2token` 把「你好博般」（拼音）转成 token，写入 `keywords.txt`，附触发阈值 `#`、可选提升分 `:`。阈值需现场调（误唤醒 vs 漏唤醒）。
- 部署：模型目录由一体机/运维**自部署**，不进安装包。解析优先级：`WAKEWORD_MODEL_DIR`(env) > 设置项 `wakeModelDir` > 默认 `~/.digital-employee/models/wake/`。目录不全则视为 `present=false`。

### 8.2 设置（electron-store，`SettingsData` 扩展）
| 字段 | 默认 | 说明 |
|---|---|---|
| `voiceWakeEnabled` | `true` | 唤醒总开关（默认开） |
| `wakeModelDir` | `""` | 模型目录覆盖（空=按默认解析） |
| `transcriptionUrl` | `""` | 转写服务地址（空=回退 `VITE_FINCH_TRANSCRIPTION_URL`） |
| `transcriptionKey` | `""` | 转写密钥（空=回退 env） |
| `transcriptionLanguage` | `""` | 语言（空=回退 env / `zh`） |

设置页加：唤醒开关、模型目录、转写服务地址/密钥/语言。IPC 经现有 settings bridge（`getPetSettings/setPetSettings` 或等价）读写。

## 9. 打包

- sherpa-onnx **KWS wasm 资产**（`sherpa-onnx-wasm-*-kws.js/.wasm` 及 worklet）随包：放渲染可加载位置（`public/` 或 `extraResources`），运行时以 URL 加载。体积小、跨平台。
- **模型不进包**（自部署，§8.1）。WASM 初始化时把模型文件读入 wasm 虚拟 FS（MEMFS），**不烤进 `.data`**，以支持外置模型。
- **不引入原生 `.node`，不需要 `asarUnpack`**。
- 在线包：可不带模型（功能自动关闭）；离线包：随机部署模型 + 本机 STT 服务地址。

## 10. 边界与错误处理

| 场景 | 行为 |
|---|---|
| 无麦克风权限 / 无设备 | 唤醒静默关闭；首次复用 `getMicErrorCopy` 提示一次；点击说话仍可用 |
| 模型目录缺失/不全 | `present=false`，唤醒不启动，无报错噪音 |
| wasm 加载/初始化失败 | 记录日志 + 关闭唤醒，降级点击说话 |
| 录音期间又触发唤醒 | 喂帧暂停期间不再触发；并加去重防抖 |
| VAD 不收敛 | 最长录音时长兜底停录 |
| 转写地址未配且 env 缺失 | 复用现有错误气泡（"识别或发送失败"） |
| 禁用/卸载/组件卸载 | 停 worklet、停麦克风轨、`kws.free()` 释放 wasm |

## 11. 测试计划

单元测试（vitest）：
- `resolve-wake-model`：目录有/无/不全 → present 判定。
- 唤醒接线：mock `usePetVoiceCurator`，`onWake` → 开录；VAD 端点 → 停录（调用次数/顺序）。
- VAD 端点判定：给定静音段 → 返回 endpoint。
- `pcm-worklet` 降采样：输入采样率 → 16k 帧长/值正确性。
- `transcribe-audio` 配置回退：运行时设置 > env > 默认 的优先级。

手动测试：
- 部署模型 → 说"你好博般" → 宠物挥手 → 说一句 → 自动转写并发总管。
- 无模型 → 唤醒关闭，点击说话照常。
- 拒绝麦克风 → 优雅降级、提示一次。
- 离线机把 `transcriptionUrl` 指向本机 STT → 端到端无外网可用。

## 12. 风险与未决

- **误唤醒率**：常驻 KWS 必有误触发，靠 `keywords.txt` 阈值/提升分现场调；唤醒词四音节相对稳。
- **WASM 外置模型加载**：需用 MEMFS 运行时挂载模型而非烤进 `.data`，要验证 sherpa-onnx wasm 该用法可行（实现期先做最小 PoC）。
- **常驻麦克风**：一体机/kiosk 可接受；普通环境是否随宠物可见性收放，留作可选优化（v1 仅受 `voiceWakeEnabled` 控制）。
- **本机 STT 服务**：部署与接口契合（须 Finch 兼容的 `/v1/audio/transcriptions`）由运维保证，客户端只对接地址。

## 13. 实现顺序（里程碑）

1. B（转写运行时可配）：`transcribe-audio` 改造 + 设置字段/页 + bridge。小、独立、先落。
2. A-PoC：sherpa-onnx KWS wasm + 外置模型 MEMFS 加载最小验证（命中即 log）。
3. A：`useWakeWord` + worklet + 模型解析 IPC + 接入 `PetWindow` + VAD 端点。
4. 设置页唤醒开关、边界降级、打包 wasm 资产。
5. 测试（单元 + 手动三场景）+ 阈值调参。
