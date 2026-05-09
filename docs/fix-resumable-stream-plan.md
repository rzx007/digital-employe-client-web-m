# 可恢复流消息错乱修复计划

## 问题概述

可恢复流（Resumable Stream）在断线重连、页面刷新、切换会话等场景下会出现消息重复、内容错乱、显示跳跃等问题。根因分布在后端 seq 编号、前端状态竞态、前后端协议缺失等多个层面。

---

## 实施状态

> **状态：全部完成** ✅

| 编号 | 优先级 | 状态 | 说明 |
|------|--------|------|------|
| F-1 | P0 | ✅ 已完成 | 后端冷路径优先使用 `stream_chunks`（含真实 seq），回退到 `chunk_json` |
| F-2 | P0 | ✅ 已完成 | 前端 `_lastSeqByChat` 按 chatId 存储游标，resume 请求带上 cursor |
| F-3 | P1 | ✅ 已完成 | `requestAnimationFrame` 延迟 + `status` 双重保护 |
| F-4 | P1 | ✅ 已完成 | `hasReceivedMessages` 状态阻止回退闪烁 |
| F-5 | P1 | ✅ 已完成 | `reconnectToStream` 内部 `AbortController` + `cancelPreviousReconnect()` |
| F-6 | P2 | ✅ 已完成 | `seq <= last_seq` 去重已在 `_emit_event_payloads` 中 |
| F-7 | P2 | ✅ 已完成 | `onFinish` 调用 `queryClient.invalidateQueries` |
| F-8 | P2 | ✅ 已完成 | `ChunkJsonBuilder` 同时输出 `to_chunk_json()` 和 `to_stream_json()` |
| F-9 | P3 | ✅ 已完成 | curator-view 同步所有前端修改 |

### 额外修复（实施中发现）

| 编号 | 优先级 | 状态 | 说明 |
|------|--------|------|------|
| A1 | P1 | ✅ 已完成 | `processResponseStream` 接受 `abortSignal` 参数，监听 abort 事件调用 `reader.cancel()` |
| A2 | P1 | ✅ 已完成 | `sendMessages` 传递 `abortSignal` 给 `processResponseStream` |
| A3 | P1 | ✅ 已完成 | `reconnectToStream` 传递 `abortController.signal` 给 `processResponseStream` |
| A4 | P1 | ✅ 已完成 | `chat-conversation-view.tsx` 卸载清理 effect 调用 `stop()` |
| A5 | P1 | ✅ 已完成 | `curator-view.tsx` 卸载清理 effect 调用 `stop()` |
| B1 | P1 | ✅ 已完成 | `processResponseStream` catch 块静默处理 `AbortError`，调用 `controller.close()` |

---

## 修复项一览

| 编号 | 优先级 | 模块 | 问题描述 | 影响文件 |
|------|--------|------|----------|----------|
| F-1 | P0 | 后端 | 冷路径回放 seq 编号使用数组索引而非真实 seq | `chat_service.py:548-549` |
| F-2 | P0 | 前端 | resume 请求不传 cursor 参数，每次从头重播 | `langchain-chat-transport.ts:57-58` |
| F-3 | P1 | 前端 | `setMessages` + `resumeStream` 同步调用导致竞态 | `chat-conversation-view.tsx:75-84` |
| F-4 | P1 | 前端 | `displayMessages` 双数据源回退导致视觉跳跃 | `chat-conversation-view.tsx:210-216` |
| F-5 | P1 | 前端 | `reconnectToStream` 缺少 AbortSignal，无法取消 | `langchain-chat-transport.ts:212-214` |
| F-6 | P2 | 后端 | subscribe 与 missed scan 之间存在竞态窗口 | `chat_service.py:589-590` |
| F-7 | P2 | 前端 | `onFinish` 不刷新 React Query 缓存 | `chat-conversation-view.tsx:58` |
| F-8 | P2 | 后端 | `ChunkJsonBuilder.to_chunk_json()` 不含 seq，冷路径无法还原真实序号 | `stream_registry.py:54-56` |
| F-9 | P3 | 前端 | curator-view 存在相同的 resume 竞态和 displayMessages 问题 | `curator-view.tsx:143-150, 161-164` |

---

## 修复方案

### F-1: 后端冷路径回放 seq 编号错误

**根因**：`chunk_json` 存储格式为 `[data1, data2, ...]`（不含 seq），冷路径回放时用 `i + 1` 作为 seq。当 buffer trim 过后，真实 seq 不再从 1 开始，导致序号错乱。

**文件**：`apps/server/src/service/chat_service.py:528-568`

**方案**：同时使用 `ChunkJsonBuilder` 的 `to_stream_json()` 格式写入 DB（包含 `{"seq": N, "data": ...}`），冷路径回放时解析完整事件而非只用 data。

**步骤**：

1. `stream_registry.py` 中 `_flush_to_db` 增加 `stream_json` 参数，将 `chunk_builder.to_stream_json()` 写入新列 `stream_chunks`（或复用现有但一直为 None 的 `stream_chunks` 列）

2. `chat_service.py:528-568` 冷路径改为解析 `stream_chunks`（含 seq 的完整事件列表）：
   ```python
   _events = await _to_thread(json.loads, _msg.stream_chunks)
   for _evt in _events:
       _seq = _evt.get("seq", 0)
       if _seq <= last_seq:
           continue
       if _seq > task.buffer.base_cursor:
           break
       # ... 后续逻辑不变
   ```

3. 保留 `chunk_json` 列不变（前端 `mapStoredMessagesToUIMessages` 可能依赖）

**验证**：模拟 buffer trim 后断线重连，确认冷路径回放事件的 seq 与实际一致。

---

### F-2: 前端 resume 不传 cursor

**根因**：`buildResumeApiUrl` 不带 cursor 查询参数，后端默认 `cursor=0`，每次重连都从头重播。

**实际实现**：transport 单例维护 `_lastSeqByChat: Map<string, number>`，`processResponseStream` 每处理一个事件后更新对应 chatId 的 seq。`reconnectToStream` 从该 Map 读取 cursor 并拼接到 URL。`sendMessages` 在新流开始时清除该 chatId 的旧值，防止跨会话游标污染。

---

### F-3: 前端 setMessages + resumeStream 竞态

**根因**：`setMessages(initialMessages)` 是异步 React 状态更新，`resumeStream()` 紧接着同步执行，`useChat` 内部可能还在用旧的（空的）messages 状态。

**实际实现**：
- resume useEffect 添加 `(status === "ready" || status === "error")` 保护
- `requestAnimationFrame` 回调内再次检查 status
- `status` 不在 useEffect 依赖数组中（避免状态变化触发重复 setMessages）
- 组件卸载时 cleanup effect 调用 `stop()` 中止活跃流

---

### F-4: displayMessages 双数据源回退

**根因**：`useChat` 的 `messages` 和 React Query 的 `initialMessages` 是两个独立状态源。`messages` 短暂为空时回退到 `initialMessages` 造成闪烁。

**实际实现**：使用 `useState(false)` 而非 `useRef`，在 `messages.length > 0` 时设为 `true`。`displayMessages` memo 在 `hasReceivedMessages` 为 true 或 `messages.length > 0` 时直接返回 `messages`，否则返回 `initialMessages`。

---

### F-5: reconnectToStream 缺少 AbortSignal

**根因**：`reconnectToStream` 硬编码 `abortSignal: undefined`，无法在组件卸载时取消。

**实际实现**：
- transport 内部维护 `_reconnectAbortController`，`cancelPreviousReconnect()` 在每次 reconnect 前调用 abort
- `sendMessages` 调用时也调用 `cancelPreviousReconnect()` 取消挂起的 reconnect
- `processResponseStream` 接受 `abortSignal` 参数，监听 abort 事件调用 `reader.cancel()` 关闭 TCP 连接
- catch 块检测 `AbortError`，静默调用 `controller.close()` 而非抛出错误

---

### F-6: 后端 subscribe-missed 竞态窗口

**根因**：`task.subscribe(_on_event)` 和 `task.buffer.get_events_after(last_seq)` 之间有微小时间窗口，新事件可能同时进入 queue 和 missed 列表。

**实际实现**：`_emit_event_payloads` 内已有 `seq <= last_seq` 去重检查（nonlocal 变量），实际运行中未出现重复事件。保持现有实现。

---

### F-7: onFinish 不刷新 React Query 缓存

**根因**：stream 完成后 `onFinish` 是空函数，React Query 的消息缓存仍为旧数据。下次加载时 `initialMessages` 从缓存读取，可能再次触发 resume。

**实际实现**：`onFinish` 回调中调用 `queryClient.invalidateQueries` 刷新 `chatKeys.messages()` 和 `chatKeys.conversations()`，确保缓存与 DB 同步。

---

### F-8: chunk_json 不含 seq 信息

**根因**：`ChunkJsonBuilder.to_chunk_json()` 只输出 `[data1, data2, ...]`，不含 seq。这是 F-1 的底层原因。

**文件**：`apps/server/src/service/stream_registry.py:54-56`

**方案**（与 F-1 联动）：

- 保留 `chunk_json` 列用于前端渲染（`mapStoredMessagesToUIMessages`）
- 同时写入 `stream_chunks` 列（使用 `to_stream_json()`），用于冷路径回放
- 在 `_flush_to_db` 和 `_flush_terminal` 中增加 `stream_json` 参数

**验证**：DB 中 `stream_chunks` 列应包含完整的 `{"seq": N, "data": ...}` 格式数据。

---

### F-9: curator-view 相同问题

**根因**：与 F-3、F-4 相同的竞态和 displayMessages 问题存在于 curator-view。

**实际实现**：与 `chat-conversation-view.tsx` 同步所有修改，包括 status 保护、rAF、`hasReceivedMessages`、`onFinish` 缓存刷新、卸载清理 `stop()`。

---

## 实际实施记录

```
第一阶段（P0 — 消除根因）
  ├── F-8: stream_registry 增加 to_stream_json() 写入 stream_chunks 列 ✅
  ├── F-1: chat_service 冷路径优先 stream_chunks，回退 chunk_json ✅
  └── F-2: transport _lastSeqByChat 游标 + sendMessages 时清除 ✅

第二阶段（P1 — 消除前端竞态）
  ├── F-3: status 双重保护 + requestAnimationFrame ✅
  ├── F-4: hasReceivedMessages 状态阻止回退闪烁 ✅
  ├── F-5: 内部 AbortController + cancelPreviousReconnect ✅
  ├── F-7: onFinish 调用 invalidateQueries ✅
  └── F-9: curator-view 同步所有修改 ✅

第三阶段（P1 — Abort 信号链完整性）
  ├── A1: processResponseStream 接受 abortSignal，abort 时 reader.cancel() ✅
  ├── A2: sendMessages 传递 abortSignal ✅
  ├── A3: reconnectToStream 传递 abortController.signal ✅
  ├── A4: chat-conversation-view 卸载清理 stop() ✅
  ├── A5: curator-view 卸载清理 stop() ✅
  └── B1: processResponseStream catch 块静默 AbortError ✅
```

### 关键架构决策

1. **Abort 信号链**：`@ai-sdk/react` 的 `Chat` 类在调用 `stop()` 时才 abort，组件卸载时不自动调用。因此在两个视图的卸载 cleanup effect 中显式调用 `stop()`。

2. **游标管理**：`_lastSeqByChat` 按 chatId 存储，每个后端流任务的 seq 从 1 开始，`sendMessages` 时清除旧值防止跨会话游标污染。

3. **Transport 重构为箭头函数**：消除 `this` 绑定问题，避免 `@typescript-eslint/no-this-alias` lint 错误，确保方法引用稳定。

4. **`processResponseStream` 的 abort 处理**：`ReadableStream.cancel` 回调中的 `reader.cancel()` 只释放本地读锁，不中止 ofetch fetch。通过 `abortSignal` 监听器显式调用 `reader.cancel()` 才能传播到 ofetch 关闭 TCP 连接。

5. **`stream_ended`/`no_stream` 事件处理**：`sseEventSchema` 的 fallback 匹配这些事件但 `parseLangChainPayloadToChunks` 产生 0 个 chunk。transport 在 `flushEvent` 中直接处理，关闭 stream 并清理。

---

## 测试验证场景

以下场景需手动验证：

1. **正常流式对话**：发送消息，确认 streaming → completed 正常
2. **刷新页面恢复**：在 streaming 中途刷新页面，确认 resume 正常，不出现重复消息
3. **网络断开恢复**：streaming 中断网，3s 后恢复，确认消息不丢失不错乱
4. **切换会话**：streaming 中切换到另一个会话，再切回，确认无幽灵更新
5. **buffer trim 后 resume**：长时间 streaming（触发 buffer trim），断线重连，确认冷路径 seq 正确
6. **并发发送**：快速连续发送多条消息（pending queue），确认按顺序执行不错乱
7. **取消流**：streaming 中点击取消，确认状态正确变为 cancelled
8. **curator 视图**：在 curator 视图中重复上述测试
9. **卸载中止**：streaming 中切换会话，确认网络请求被取消，无 AbortError toast
