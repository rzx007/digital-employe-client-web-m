# 可恢复流消息错乱修复计划

## 问题概述

可恢复流（Resumable Stream）在断线重连、页面刷新、切换会话等场景下会出现消息重复、内容错乱、显示跳跃等问题。根因分布在后端 seq 编号、前端状态竞态、前后端协议缺失等多个层面。

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

**文件**：`apps/web/src/lib/chat/langchain-chat-transport.ts:57-58, 128-156`

**方案**：

1. `reconnectToStream` 方法需要接收 `cursor` 参数。查看 `@ai-sdk/react` 的 `ChatTransport.reconnectToStream` 签名，确认是否能传递自定义参数。

2. 修改 `buildResumeApiUrl`：
   ```typescript
   function buildResumeApiUrl(conversationId: string, cursor?: number) {
     const base = `/chat/conversations/${conversationId}/stream/resume`
     if (cursor && cursor > 0) {
       return `${base}?cursor=${cursor}`
     }
     return base
   }
   ```

3. 前端需要知道最后收到的 seq。可选方案：
   - **方案 A**：在 SSE 事件中后端已发送 `id: {seq}` 行，前端解析后存储在 `useChat` 的 message metadata 中
   - **方案 B**：利用 `@ai-sdk/react` 的 `onFinish` 回调中记录最后一次 seq
   - **方案 C**（推荐）：前端在调用 `resumeStream` 前从 DB 消息的 `chunk_json` 长度推算 cursor

**验证**：断开网络后恢复，确认 resume 请求带上了正确的 cursor。

---

### F-3: 前端 setMessages + resumeStream 竞态

**根因**：`setMessages(initialMessages)` 是异步 React 状态更新，`resumeStream()` 紧接着同步执行，`useChat` 内部可能还在用旧的（空的）messages 状态。

**文件**：
- `apps/web/src/components/chat/chat-conversation-view.tsx:75-84`
- `apps/web/src/components/chat/curator/curator-view.tsx:143-150`

**方案**：将 `resumeStream` 延迟到下一帧执行，确保 `setMessages` 已生效：

```typescript
React.useEffect(() => {
  if (initialMessages.length > 0) {
    setMessages(initialMessages)

    const lastStored = storedMessages[storedMessages.length - 1]
    if (lastStored?.role === "assistant" && lastStored.streamState === "streaming") {
      // 延迟到下一帧，确保 setMessages 已被 React 应用
      const rafId = requestAnimationFrame(() => {
        resumeStream()
      })
      return () => cancelAnimationFrame(rafId)
    }
  }
}, [conversationId, initialMessages, setMessages, resumeStream, storedMessages])
```

**验证**：在 streaming 状态下刷新页面，确认不会出现两条 assistant 消息。

---

### F-4: displayMessages 双数据源回退

**根因**：`useChat` 的 `messages` 和 React Query 的 `initialMessages` 是两个独立状态源。`messages` 短暂为空时回退到 `initialMessages` 造成闪烁。

**文件**：`apps/web/src/components/chat/chat-conversation-view.tsx:210-216`

**方案**：用一个 ref 追踪 `useChat` 是否曾经有过消息，避免回退：

```typescript
const hasReceivedMessages = React.useRef(false)

React.useEffect(() => {
  if (messages.length > 0) {
    hasReceivedMessages.current = true
  }
}, [messages])

const displayMessages = React.useMemo(() => {
  if (hasReceivedMessages.current || messages.length > 0) {
    return messages
  }
  return initialMessages
}, [initialMessages, messages])
```

或者更简洁：始终使用 `messages`，只在首次 mount 时通过 `useChat` 的 `initialMessages` prop 传入（已做），移除 useEffect 中的 `setMessages`。

**验证**：切换会话时不应出现消息闪烁。

---

### F-5: reconnectToStream 缺少 AbortSignal

**根因**：`reconnectToStream` 硬编码 `abortSignal: undefined`，无法在组件卸载时取消。

**文件**：`apps/web/src/lib/chat/chat-conversation-transport.ts:205-222`

**方案**：

1. 检查 `@ai-sdk/react` 的 `ChatTransport.reconnectToStream` 签名是否支持传递 abortSignal
2. 如果支持，透传 signal：
   ```typescript
   async reconnectToStream({ chatId, abortSignal }) {
     // ...
     const stream = await createResumeEventSourceResponse({
       conversationId: chatId,
       abortSignal,
     })
     // ...
   }
   ```
3. 如果不支持，在 transport 内部维护 AbortController，在 `sendMessages` 调用时取消之前的 reconnect

**验证**：在 streaming 状态下切换到另一个会话，确认网络请求被取消。

---

### F-6: 后端 subscribe-missed 竞态窗口

**根因**：`task.subscribe(_on_event)` 和 `task.buffer.get_events_after(last_seq)` 之间有微小时间窗口，新事件可能同时进入 queue 和 missed 列表。

**文件**：`apps/server/src/service/chat_service.py:584-603`

**方案**：先订阅再扫描 missed（当前代码已如此），但在 missed 处理中加 `seq <= last_seq` 去重（`_emit_event_payloads` 内已有此检查）。问题在于 `_emit_event_payloads` 内的 `last_seq` 是 `nonlocal` 变量，在 await 期间可能已被 queue 消费更新。

更可靠的方案是在 `ActiveStreamTask` 中加锁：

```python
def subscribe_and_replay(self, fn, cursor):
    """原子操作：订阅 + 获取 missed 事件"""
    self.subscribers.add(fn)
    missed = self.buffer.get_events_after(cursor)
    return missed
```

**验证**：高并发场景下不再出现重复事件。

---

### F-7: onFinish 不刷新 React Query 缓存

**根因**：stream 完成后 `onFinish` 是空函数，React Query 的消息缓存仍为旧数据。下次加载时 `initialMessages` 从缓存读取，可能再次触发 resume。

**文件**：
- `apps/web/src/components/chat/chat-conversation-view.tsx:58`
- `apps/web/src/components/chat/curator/curator-view.tsx:113`

**方案**：

```typescript
const queryClient = useQueryClient()

// useChat 配置中
onFinish: () => {
  queryClient.invalidateQueries({
    queryKey: chatKeys.messages(Number(conversationId))
  })
  queryClient.invalidateQueries({
    queryKey: chatKeys.conversations()
  })
},
```

**验证**：stream 完成后切换会话再切回，消息应正常显示，不会再次触发 resume。

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

**文件**：
- `apps/web/src/components/chat/curator/curator-view.tsx:143-150`
- `apps/web/src/components/chat/curator/curator-view.tsx:161-164`

**方案**：与 F-3、F-4 同步修改。

---

## 实施顺序

```
第一阶段（P0 — 消除根因）
  ├── F-8: stream_registry 增加 stream_json 写入
  ├── F-1: chat_service 冷路径改用 stream_chunks
  └── F-2: 前端 resume 传 cursor

第二阶段（P1 — 消除前端竞态）
  ├── F-3: setMessages + resumeStream 加 requestAnimationFrame
  ├── F-4: displayMessages 用 ref 追踪避免回退
  └── F-5: reconnectToStream 透传 abortSignal

第三阶段（P2 — 增强健壮性）
  ├── F-6: 后端 subscribe_and_replay 原子操作
  └── F-7: onFinish 刷新 React Query 缓存

第四阶段（P3 — 同步修复）
  └── F-9: curator-view 同步所有前端修改
```

---

## 测试验证场景

1. **正常流式对话**：发送消息，确认 streaming → completed 正常
2. **刷新页面恢复**：在 streaming 中途刷新页面，确认 resume 正常，不出现重复消息
3. **网络断开恢复**：streaming 中断网，3s 后恢复，确认消息不丢失不错乱
4. **切换会话**：streaming 中切换到另一个会话，再切回，确认无幽灵更新
5. **buffer trim 后 resume**：长时间 streaming（触发 buffer trim），断线重连，确认冷路径 seq 正确
6. **并发发送**：快速连续发送多条消息（pending queue），确认按顺序执行不错乱
7. **取消流**：streaming 中点击取消，确认状态正确变为 cancelled
8. **curator 视图**：在 curator 视图中重复上述测试
