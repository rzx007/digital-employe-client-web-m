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
| 录音声波组件 | ElevenLabs UI `LiveWaveform`（源码拷入 packages/ui，自包含、无额外依赖） |
| 音频存储 | 后端新增专用 voice 接口，存会话目录下 `voice/` 子目录，不进资源面板 |

## 整体数据流

```
点麦克风 → LiveWaveform 打开麦克风流（onStreamReady 共享给 MediaRecorder）
→ 点「发送」停止录音 → 得到 audio blob
→ ① Finch ASR 转写（失败则 toast 终止）
→ ② 上传音频到本地后端，得到 audio_path
→ 走现有发送链路：question = 转写文本，extra_meta.voice = { duration_ms, audio_path }
→ 后端照常持久化用户消息（conversation_messages 表零改动，复用 extra_meta JSON 字段）
→ 消息列表：metadata.voice 存在 → 渲染语音胶囊（点击播放 / 右键看文本）
```

转写与上传**串行（先转写后上传）**：转写失败时直接终止，后端不留孤儿音频文件。上传走本地 FastAPI，耗时可忽略。

## 录音交互细节

- 麦克风按钮位于输入框底部右侧、发送按钮旁。
- 可用条件：`conversationId != null` 且聊天状态非 streaming/submitted。草稿视图（会话未创建）不显示麦克风按钮——音频上传需要会话 ID。
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
- 胶囊外观：播放/暂停图标 + 静态声波纹 + 时长文本（如 `0:23`），宽度随时长适度增长（微信风格，设上下限）。
- 点击播放：
  - 通过 `GET /chat/conversations/{id}/voice/audio?path=` 拉取音频 blob（带鉴权头），`URL.createObjectURL` 后用 `HTMLAudioElement` 播放
  - 播放中图标做动画，再次点击暂停；同一时间只允许一条语音在播
  - blob 按消息缓存（内存级），避免重复请求
  - 音频文件缺失/拉取失败：toast 提示「语音文件不存在」
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
}
```

前端 `apps/web/src/types/chat.ts` 增加对应 TypeScript 类型。后端消息表零改动。

## 后端接口（约 60 行 Python）

`apps/server/src/api/chat_api.py` 新增两个端点，存储逻辑放 `ResourceService`：

1. `POST /chat/conversations/{conversation_id}/voice/upload`
   - 接收 `UploadFile`，存到会话工作目录下 `voice/` 子目录，文件名 `{uuid}.webm`
   - `voice/` 目录不在资源面板的列举范围内（资源列举只扫既有目录，新子目录天然不可见，需验证确认）
   - 返回 `{ audio_path: "voice/<uuid>.webm" }`
2. `GET /chat/conversations/{conversation_id}/voice/audio?path=`
   - 校验 path 必须位于该会话的 `voice/` 目录内（防路径穿越，复用 ResourceService 现有校验模式）
   - `FileResponse` 返回音频（`audio/webm`）

会话删除时：会话工作目录整体清理的现有逻辑天然覆盖 `voice/` 子目录，无需额外处理（实现时验证）。

## 前端文件清单

| 文件 | 动作 | 内容 |
|---|---|---|
| `packages/ui/src/components/ai-elements/live-waveform.tsx` | 新增 | 拷入 ElevenLabs `LiveWaveform` 源码（约 560 行），import 改为 `@workspace/ui/lib/utils` |
| `apps/web/src/components/chat-prompt-input/voice-recorder.tsx` | 新增 | 录音覆盖层 UI + `useVoiceRecorder` hook（MediaRecorder 接 onStreamReady 流、计时、取消/发送/60s 超时/1s 过短） |
| `apps/web/src/components/chat/messages/voice-message-capsule.tsx` | 新增 | 胶囊渲染 + 播放控制 + 右键菜单 + 文本展开 |
| `apps/web/src/lib/voice/transcribe.ts` | 新增 | 将 `lib/pet/transcribe-audio.ts` 的实现提升为共享模块；宠物处改为转发引用，行为不变 |
| `apps/web/src/api/conversation.ts` | 修改 | 新增 `uploadVoiceAudio(conversationId, blob)`、`fetchVoiceAudio(conversationId, path)` |
| `apps/web/src/components/chat-prompt-input/chat-prompt-input.tsx` + `types.ts` | 修改 | 麦克风按钮、录音覆盖层挂载；onSubmit 消息类型扩展可选 `voice` 字段 |
| `apps/web/src/components/chat/views/chat-conversation-view.tsx` | 修改 | `doSend` 的 `pendingMeta` 增加 `voice` 透传（进 `extra_meta` 与乐观渲染 metadata） |
| `apps/web/src/components/chat/messages/chat-message-item.tsx` | 修改 | 用户消息分支按 `metadata.voice` 切换胶囊渲染 |
| `apps/web/src/types/chat.ts` | 修改 | `VoiceMessageMeta` 类型 |

## 测试

- `useVoiceRecorder` 状态机单测：开始/取消/正常停止/60s 自动停止/不足 1s 丢弃
- 转写共享模块迁移后，宠物语音入口行为不回归（现有引用全部更新、类型检查通过）
- 后端：voice upload/download 端点的路径校验测试（含路径穿越拒绝）
- 手动验证清单：录音 → 胶囊展示 → 点击播放 → 右键查看/复制文本 → 刷新页面后仍可播放 → 取消录音 → 转写失败路径（断开 ASR）

## 明确不做（YAGNI）

- 草稿视图（无会话 ID）的语音输入
- 语音消息的波形可视化回放（按真实音频幅度绘制）——胶囊用静态装饰纹
- 转写文本发送前编辑
- 音频格式转码（统一 webm）
- 转写失败后保留录音重试
