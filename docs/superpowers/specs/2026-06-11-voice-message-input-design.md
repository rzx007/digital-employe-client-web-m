# 聊天输入框语音消息 设计文档

日期：2026-06-11
状态：已与用户确认方案，待实现

## 背景与目标

聊天输入框需要支持语音输入：用户录音后由 ASR 转写成文字发送给模型，但消息列表中该消息以**语音胶囊**形式展示（微信风格），可点击播放原始录音，右键查看转写文本。

本应用为本地 Electron 应用，Python FastAPI 后端运行在本机，音频存本地后端无带宽顾虑。

### 已确认的关键决策

| 决策点 | 结论 |
|---|---|
| 胶囊是否可播放原音 | 是，音频上传本地后端持久化 |
| 发送时机 | 微信式：停止录音 → 自动转写 → 自动发出 |
| 录音交互 | 微信桌面版式：点麦克风开始，录音胶囊 + 实时声波，悬停出现「发送」，✕ 取消 |
| 转写失败 | toast 报错、消息不发出，录音丢弃由用户重录 |
| 录音声波组件 | ElevenLabs UI `LiveWaveform`（源码拷入 packages/ui，自包含、无额外依赖）。已读源码验证：暴露 `onStreamReady(stream)`（可把它打开的麦克风流共享给 MediaRecorder）、`processing`（转写中动画）、`onError`（内部 `getUserMedia` 失败时的 DOMException 由此冒泡，接入权限错误文案映射） |
| 音频存储 | 后端新增专用 voice 接口，存会话目录下 `voice/` 子目录，不进资源面板 |
| 草稿视图 | 支持语音输入：首条消息发送时 `doSend` 先创建会话，音频上传随后进行 |
| 胶囊波形 | 真实振幅波形：发送端解码 blob 计算约 40 个峰值，随 `extra_meta.voice.waveform` 持久化，播放时进度高亮 |

## 整体数据流

```
点麦克风 → LiveWaveform 打开麦克风流（onStreamReady 共享给 MediaRecorder）
→ 点「发送」停止录音 → 得到 audio blob
→ 录音器内：① Finch ASR 转写（失败则 toast 终止）
            ② AudioContext 解码 blob，计算约 40 个振幅峰值（waveform 数组）
→ onSubmit({ text: 转写文本, voice: { durationMs, waveform, blob } }) 交给视图层
→ 视图层 doSend：确保会话 ID（草稿视图此处先创建会话）
→ 上传 blob 到本地后端，得到 audio_path（失败则 toast 终止，不发出）
→ 走现有发送链路：question = 转写文本，
   extra_meta.voice = { duration_ms, audio_path, waveform }
→ 后端照常持久化用户消息（conversation_messages 表零改动，复用 extra_meta JSON 字段）
→ 消息列表：metadata.voice 存在 → 渲染语音胶囊（真实波形 / 点击播放 / 右键看文本）
```

职责切分：**录音器只产出数据（转写文本、时长、波形峰值、blob），不接触会话 ID**；音频上传放在视图层 `doSend` 内、紧跟会话 ID 就绪之后——这使草稿视图（首条消息发送时才创建会话）与既有会话视图共用同一条路径。上传与发送的公共逻辑抽成 `prepareVoiceMeta(conversationId, voice)` 辅助函数。

顺序为**先转写、后上传**：转写失败时直接终止，后端不留孤儿音频文件。上传走本地 FastAPI，耗时可忽略。「上传成功但发送消息失败」仍可能留下孤儿 `voice/*.webm`——本地小文件、会话删除时整目录清理兜底，显式接受该取舍。

## 录音交互细节

- 麦克风按钮位于输入框底部右侧、发送按钮旁。
- 可用条件：聊天状态非 streaming/submitted。**既有会话视图与草稿视图均支持**——草稿视图首条消息发送时 `doSend` 先创建会话再上传音频（见数据流）。**群聊不显示麦克风按钮**（既有群会话视图，以及草稿视图中目标联系人为群组 `contact.type === "group"` 时；首期仅单聊，见 YAGNI）。
- 生命周期清理：`useVoiceRecorder` 在组件卸载（含录音中切换会话/关闭窗口）时等价于「取消」——stop MediaRecorder、`stream.getTracks().forEach(t => t.stop())` 释放麦克风、丢弃已录数据。
- **转写完成时恰逢 busy**：麦克风可用性只约束录音开始时机；录音最长 60 秒，期间状态可能回到 streaming/submitted。语音消息**绕过 pending 队列直接走 `doSend`**（发送链路支持并发落库）——现有 pending 队列入队项不携带 voice 载荷，若走队列会静默降级为纯文本，故明确绕过。
- 点击麦克风后，输入区覆盖**录音层**：
  - 左侧 ✕ 按钮：取消录音，丢弃数据，恢复普通输入框
  - 右侧胶囊：`LiveWaveform`（scrolling 模式）实时声波 + 已录时长计时
  - 鼠标悬停胶囊：声波淡出、浮现「发送」字样；点击 → 停止录音进入转写
  - 转写期间胶囊切 `LiveWaveform` 的 `processing` 动画；完成后自动发出并恢复普通输入框
- 时长限制：
  - 最长 60 秒：到时自动停止并进入发送流程（同微信）
  - 最短 1 秒：视为误触，提示「说话时间太短」并丢弃
- 错误处理：
  - 麦克风权限/设备错误：复用 `use-pet-voice-curator.ts` 中的 DOMException → 中文文案映射（NotAllowedError / NotFoundError / NotReadableError 等）
  - 转写失败或返回空文本：toast 报错，不发出消息
- 录音格式：MediaRecorder 默认 `audio/webm`（与宠物语音转写链路一致）。

## 语音胶囊（消息列表）

- 渲染位置：`chat-message-item.tsx` 用户消息分支。`metadata.voice` 存在时不渲染文本气泡，改渲染胶囊。
- 胶囊外观：播放/暂停图标 + **真实振幅波形条** + 时长文本（如 `0:23`），宽度随时长适度增长（微信风格，设上下限）。
- 真实波形：波形峰值数组在**发送端**用 AudioContext 解码 blob 一次性计算（约 40 个 0–100 整数，随 `extra_meta.voice.waveform` 持久化），渲染时零额外请求；播放时按播放进度高亮已播部分的波形条。波形条用简单 div/canvas 自绘（数据已归一化，无需引入组件）。`waveform` 缺失或为空时退化为均匀装饰条。
- 点击播放：
  - 通过 `GET /chat/conversations/{id}/voice/audio?path=` 拉取音频 blob（带鉴权头），`URL.createObjectURL` 后用 `HTMLAudioElement` 播放
  - 播放中图标做动画，再次点击暂停；同一时间只允许一条语音在播
  - 音频文件缺失/拉取失败：toast 提示「语音文件不存在」
- **播放状态归属（重要）**：消息列表是 `@tanstack/react-virtual` 虚拟滚动，滚出视口的胶囊组件会被卸载。因此播放状态、`HTMLAudioElement` 实例、blob 缓存**不放在胶囊组件内**，而是放在模块级单例 `voice-playback-manager`（`apps/web/src/lib/voice/playback-manager.ts`）：
  - 单例持有当前播放的 `{ messageId, audio, objectUrl }` 与 blob 缓存 Map（按消息 id）
  - 胶囊组件仅订阅「当前播放消息 id + 播放中状态」，卸载不中断播放，滚回视口恢复动画
  - 单实例播放（播 B 自动停 A）由单例天然保证
- 右键 ContextMenu（复用 `packages/ui` 现有组件）：
  - **查看文本**：在胶囊下方展开/收起转写文本气泡
  - **复制文本**：复制转写文本到剪贴板
- 转写文本即 `message.content`（模型收到的内容），无额外存储，天然一致。

## 数据结构

`extra_meta.voice`（随用户消息持久化，前端读作 `metadata.voice`）：

```ts
interface VoiceMessageMeta {
  duration_ms: number   // 录音时长（毫秒）
  audio_path: string    // 相对路径，如 "voice/<uuid>.webm"
  waveform: number[]    // 振幅峰值，约 40 个 0–100 整数，发送端计算
}
```

前端 `apps/web/src/types/chat.ts` 增加对应 TypeScript 类型。后端消息表零改动。

## 后端接口（约 60 行 Python）

`apps/server/src/api/chat_api.py` 新增两个端点，存储逻辑放 `ResourceService`：

1. `POST /chat/conversations/{conversation_id}/voice/upload`
   - 接收 `UploadFile`，存到 `<artifacts_root>/<conversation_id>/voice/` 子目录，文件名 `{uuid}.webm`
   - **物理路径固定按 conversation_id 解析，不走 `_resolve_conversation_dir`**——后者对群会话会解析到共享的 `room-<room_id>/` 目录，与会话删除清理路径（`<artifacts_root>/<conversation_id>/`）不一致，会产生孤儿文件
   - `voice/` 目录不在资源面板列举范围内（已验证：`resource_service.py` 的 `list_resources` 只扫 `artifacts`/`uploads`/`skills-draft` 三个固定子目录）
   - 返回 `ResponseBase[VoiceUploadResult]`，`data = { audio_path: "voice/<uuid>.webm" }`（与 chat_api.py 现有端点的响应包裹风格一致）
2. `GET /chat/conversations/{conversation_id}/voice/audio?path=`
   - 校验 path 必须位于该会话的 `voice/` 目录内（防路径穿越，复用 ResourceService 现有校验模式）
   - `FileResponse` 返回音频（`audio/webm`）

会话删除时：`chat_service.py` 对 `<artifacts_root>/<conversation_id>/` 整目录 `rmtree`（已验证），天然覆盖 `voice/` 子目录，无需额外处理。

## 前端文件清单

| 文件 | 动作 | 内容 |
|---|---|---|
| `packages/ui/src/components/ai-elements/live-waveform.tsx` | 新增 | 拷入 ElevenLabs `LiveWaveform` 源码（约 560 行），import 改为 `@workspace/ui/lib/utils` |
| `apps/web/src/components/chat-prompt-input/voice-recorder.tsx` | 新增 | 录音覆盖层 UI + `useVoiceRecorder` hook（MediaRecorder 接 onStreamReady 流、计时、取消/发送/60s 超时/1s 过短）；停止后转写 + 计算波形峰值，产出 `{ text, voice: { durationMs, waveform, blob } }` |
| `apps/web/src/lib/voice/prepare-voice-meta.ts` | 新增 | `prepareVoiceMeta(conversationId, voice)`：上传 blob → 返回 `extra_meta.voice` 对象；两个视图共用 |
| `apps/web/src/lib/voice/compute-waveform.ts` | 新增 | AudioContext 解码 blob → 约 40 个归一化振幅峰值 |
| `apps/web/src/components/chat/messages/voice-message-capsule.tsx` | 新增 | 胶囊渲染 + 右键菜单 + 文本展开（播放状态订阅自 playback-manager） |
| `apps/web/src/lib/voice/playback-manager.ts` | 新增 | 模块级单例：HTMLAudioElement、blob 缓存、当前播放消息 id、单实例播放协调 |
| `apps/web/src/lib/voice/transcribe.ts` | 新增 | 将 `lib/pet/transcribe-audio.ts` 的实现提升为共享模块；宠物处改为转发引用，行为不变 |
| `apps/web/src/api/conversation.ts` | 修改 | 新增 `uploadVoiceAudio(conversationId, blob)`、`fetchVoiceAudio(conversationId, path)` |
| `packages/ui/src/components/ai-elements/prompt-input.tsx` | 修改 | `PromptInputMessage` 接口增加可选 `voice?` 字段（向后兼容，定义即在此处，勿在 apps/web 另造派生类型） |
| `apps/web/src/components/chat-prompt-input/chat-prompt-input.tsx` + `types.ts` | 修改 | 麦克风按钮、录音覆盖层挂载；新增 `showVoiceInput` prop 控制麦克风显隐 |
| `apps/web/src/components/chat/panel/chat-panel.tsx` | 修改 | 透传 `showVoiceInput`（群聊为 false，仿现有 `showContextBudget={contact?.type !== "group"}` 先例） |
| `apps/web/src/components/chat/panel/chat-composer-area.tsx` | 修改 | 透传 `showVoiceInput` prop |
| `apps/web/src/components/chat/views/chat-conversation-view.tsx` | 修改 | `doSend`：消息带 `voice` 时调 `prepareVoiceMeta` 上传，`pendingMeta` 增加 `voice`（进 `extra_meta` 与乐观渲染 metadata） |
| `apps/web/src/components/chat/views/chat-draft-view.tsx` | 修改 | `doSend`：会话创建后同样调 `prepareVoiceMeta` 上传并透传 `voice`；群组联系人隐藏麦克风 |
| `apps/web/src/components/chat/messages/chat-message-item.tsx` | 修改 | 用户消息分支按 `metadata.voice` 切换胶囊渲染 |
| `apps/web/src/types/chat.ts` | 修改 | `VoiceMessageMeta` 类型 |

## 测试

- `useVoiceRecorder` 状态机单测：开始/取消/正常停止/60s 自动停止/不足 1s 丢弃/**卸载时释放麦克风与数据**
- `voice-playback-manager` 单测：单实例播放（播 B 停 A）、blob 缓存命中
- `compute-waveform` 单测：已知音频样本 → 峰值数量与归一化范围正确；空/异常 blob 不抛出（返回空数组）
- 转写共享模块迁移后，宠物语音入口行为不回归（现有引用全部更新、类型检查通过）
- 后端：voice upload/download 端点的路径校验测试（含路径穿越拒绝）
- 手动验证清单：录音 → 胶囊展示（真实波形）→ 点击播放（进度高亮）→ **播放中滚动消息列表使胶囊滚出视口，播放不中断、滚回后状态正确** → 右键查看/复制文本 → 刷新页面后仍可播放 → 取消录音 → 录音中切换会话（麦克风释放）→ 转写失败路径（断开 ASR）→ **草稿视图首条语音消息（建会话→上传→发送全链路）**

## 明确不做（YAGNI）

- 群聊会话的语音输入（后端 voice 目录按 conversation_id 存储的前提下，群聊涉及 room 共享目录语义，首期不做；含草稿视图选中群组联系人的场景）
- 转写文本发送前编辑（用户二次确认：维持微信式自动发出）
- 音频格式转码（用户二次确认：统一 webm，本地录、本地播，零额外依赖）
- 转写失败后保留录音重试

> 修订记录：草稿视图语音输入、真实波形回放原列于此，2026-06-11 用户要求纳入范围，已并入正文设计。
