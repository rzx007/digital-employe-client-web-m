```
═══════════════════════════════════════════════════════════════════════════
                   前端对话完整流程图
═══════════════════════════════════════════════════════════════════════════


  ╔═════════════════════════════════════════════════════════════════════╗
  ║                    1. 正常发送消息流程                              ║
  ╚═════════════════════════════════════════════════════════════════════╝

  用户输入 → 点击发送
      │
      ▼
  handleSendMessage()
      │
      ├── isBusy? ──是──→ enqueue (加入待发队列, PendingMessageQueue)
      │                   等待当前流完成后自动发送
      │
      否
      │
      ▼
  doSend(message)
      │
      ▼
  useChat.sendMessage({ text }, {
      body: { conversationId, skill, metadata }
  })
      │
      ▼
  LangChainChatTransport.sendMessages()     ◄── transports/layer
      │
      ├── cancelPreviousReconnect()          ◄── 取消残留的 resume 请求
      ├── POST /chat/conversations/{id}/stream
      │       body: { question, skill, extra_meta }
      │
      ▼
  processResponseStream(stream, convId)
      │
      │   ┌─────────────────────────────────────────┐
      │   │         SSE 流读取循环                    │
      │   │                                         │
      │   │  reader.read() ──→ buffer 拼接          │
      │   │       │                                 │
      │   │       ▼                                 │
      │   │  getEventBoundaryIndex(buffer)           │
      │   │       │                                 │
      │   │       ▼                                 │
      │   │  flushEvent(eventText)                  │
      │   │       │                                 │
      │   │       ├── 解析 id: {seq} 行             │
      │   │       │   └── 记录 _lastSeqByChat        │
      │   │       │                                 │
      │   │       ├── 提取 data: 行                 │
      │   │       │                                 │
      │   │       ├── data === "[DONE]" ?           │
      │   │       │   ├─ enqueue "finish" chunk     │
      │   │       │   └─ controller.close()         │
      │   │       │                                 │
      │   │       └── JSON.parse(data)              │
      │   │           │                             │
      │   │           ├── tool_output 事件?         │
      │   │           │   └─ buildToolOutputStreamingChunk()│
      │   │           │                             │
      │   │           └── parseLangChainPayloadToChunks()│
      │   │               │                         │
      │   │               ├── AI文本块 → text-delta │
      │   │               ├── 工具调用 → tool-input-*│
      │   │               └── 工具结果 → tool-output-*│
      │   │                                         │
      │   │  controller.enqueue(chunk) ──→ useChat  │
      │   └─────────────────────────────────────────┘
      │
      ▼
  useChat 内部状态更新
      │
      ├── messages 数组追加新 part
      ├── status: "streaming"
      │
      ▼
  React re-render → ChatPanel → VirtualizedMessageList
      │
      │  渲染：
      │  ├── user 消息气泡
      │  └── assistant 消息气泡 (逐字追加)
      │
      ▼
  流结束 ([DONE] 到达)
      │
      ├── status: "ready"
      ├── onFinish() → queryClient.invalidateQueries(messages)
      │                   │
      │                   └── React Query 重新拉取消息
      │                       streamState: "completed" ✓
      │
      └── _reconnectAbort = null


  ╔═════════════════════════════════════════════════════════════════════╗
  ║                    2. 加载历史记录流程                              ║
  ╚═════════════════════════════════════════════════════════════════════╝

  组件首次 mount (或 conversationId 变化)
      │
      ▼
  useMessagesQuery(conversationId)
      │
      ├── GET /chat/conversations/{id}/messages
      │    返回: [{ id, role, content, chunk_json, stream_state, stream_cursor, ... }]
      │
      ▼
  mapStoredMessagesToUIMessages(storedMessages)
      │
      │  遍历每条 stored message:
      │    ├── user 消息 → 直接映射 text part
      │    └── assistant 消息:
      │        ├── 有 chunk_json? → parse → 逐条调用 parseLangChainPayloadToChunks()
      │        │                      重现 tool-input / tool-output / text part
      │        └── 无 chunk_json?  → 只显示 content 纯文本
      │
      ▼
  initialMessages (UIMessage[])
      │
      ▼
  useChat({
      id: String(conversationId),        ◄── 跨 mount 持久化 key
      messages: initialMessages,         ◄── 初始消息状态
      transport: chatTransport,
  })
      │
      ├── 返回 messages = initialMessages (初始)
      ├── 返回 status = "ready"
      │
      ▼
  useEffect: setMessages(initialMessages)
      │
      ├── 恢复上次未完成的流? (见流程 3)
      │
      ▼
  displayMessages
      │
      ├── messages.length > 0 ?
      │   └── 是 → 使用 useChat 的 messages (实时)
      │
      ├── hasReceivedMessages ?
      │   └── 是 → 使用 useChat 的 messages (曾收到过, 不回退)
      │
      └── 否 → 使用 initialMessages (React Query 缓存)
      │
      ▼
  React re-render → 渲染历史消息列表


  ╔═════════════════════════════════════════════════════════════════════╗
  ║                    3. 可恢复流 (Resume) 流程                        ║
  ╚═════════════════════════════════════════════════════════════════════╝

  场景: 用户在 streaming 中途切走 → 再切回来

  ┌─────────────────────────────────────────────────────────────────────┐
  │  切走时:                                                            │
  │                                                                     │
  │  ChatView key={convId} 变化 → 组件 unmount                          │
  │                                                                     │
  │  transport._lastSeqByChat 仍保留该 conv 的最后 seq                  │
  │  后端仍在运行，buffer 中持续产生事件                                   │
  │  DB 中 assistant 消息 stream_state = "streaming"                     │
  └─────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────┐
  │  切回时 (组件重新 mount):                                             │
  │                                                                     │
  │  ① useMessagesQuery → storedMessages                                │
  │     └── 最后一条 assistant 消息 streamState === "streaming"          │
  │                                                                     │
  │  ② initialMessages = mapStoredMessagesToUIMessages(storedMessages)   │
  │     包含未完成 assistant 消息的部分 parts                              │
  │                                                                     │
  │  ③ useChat({ id: convId, messages: initialMessages })               │
  │     status = "ready"  (尚未发起新的请求)                              │
  │                                                                     │
  │  ④ useEffect 触发:                                                   │
  │                                                                     │
  │     setMessages(initialMessages)  ──→ 恢复 UI 到中断前的状态         │
  │                                                                     │
  │     ┌─ 条件检查 ──────────────────────────────────────┐             │
  │     │                                                 │             │
  │     │ lastStored.role === "assistant"             ✓   │             │
  │     │ lastStored.streamState === "streaming"      ✓   │             │
  │     │ (status === "ready" || status === "error")  ✓   │ ← 关键防护  │
  │     │                                                 │             │
  │     │ → requestAnimationFrame(resumeStream)           │             │
  │     └─────────────────────────────────────────────────┘             │
  │                                                                     │
  │  ⑤ rAF 回调: resumeStream()                                         │
  │     │                                                               │
  │     └─→ LangChainChatTransport.reconnectToStream({ chatId: convId })│
  │           │                                                         │
  │           ├── cancelPreviousReconnect()                             │
  │           │   └── 取消上一次残留的 resume 请求 (如有)                  │
  │           │                                                         │
  │           ├── new AbortController()                                 │
  │           │                                                         │
  │           ├── cursor = _lastSeqByChat.get(chatId) ?? 0              │
  │           │   如果之前收到过 SSE, 传 cursor 跳过已收到的事件           │
  │           │                                                         │
  │           ├── GET /chat/conversations/{id}/stream/resume?cursor=N   │
  │           │   signal: abortController.signal                        │
  │           │                                                         │
  │           └── processResponseStream(stream, chatId, abortController)│
  │                 │                                                   │
  │                 └── (同正常流程的 SSE 解析循环)                        │
  │                                                                     │
  │  ⑥ 后端 resume 返回:                                                 │
  │     ┌──────────────────────────────────────────────────────┐        │
  │     │ Phase 1: 冷路径 - 从 DB stream_chunks 补齐缺失事件     │        │
  │     │ Phase 2: Buffer 扫描 - 从内存 buffer 补齐              │        │
  │     │ Phase 3: 订阅 - 注册进实时事件队列                      │        │
  │     │ Phase 4: 等待 - queue.get() 持续接收新 SSE            │        │
  │     └──────────────────────────────────────────────────────┘        │
  │                                                                     │
  │  ⑦ useChat 持续消费 UIMessageChunk 流                               │
  │     status: "streaming" → 此时不会再触发第二个 resume (status 防护)   │
  │                                                                     │
  │  ⑧ [DONE] 到达:                                                     │
  │     ├── status: "ready"                                             │
  │     ├── _lastSeqByChat 更新为最后 seq                                │
  │     ├── onFinish() → invalidateQueries(messages)                    │
  │     │   └── React Query 拉取最新数据                                │
  │     │       streamState: "completed" ✓                              │
  │     ├── _reconnectAbort = null (条件清除, 不覆盖新 controller)       │
  │     └── contains() → close                                          │
  └─────────────────────────────────────────────────────────────────────┘


═══════════════════════════════════════════════════════════════════════════
                         关键防重复机制

  问题: useEffect 在 streaming 期间被 React 重复触发
        → resumeStream() 被调用两次
        → 第二次的 cancelPreviousReconnect() 杀掉第一次的 fetch
        → "BodyStreamBuffer was aborted"


  修复: useEffect 条件中加入 status 检查

        status === "ready" ────→ 允许 resumeStream()
        status === "streaming" → 跳过 (正在流式传输中)
        status === "submitted" → 跳过 (正在提交中)


  生命周期:
   mount → status="ready" → resume ✓ → status="streaming"
        → [DONE] → status="ready" → 再次 resume ✓ (如果需要)

  加入该条件后:
   - useEffect 重复触发 → status 仍是 "streaming" → 跳过
   - 流结束后 → status 自动回到 "ready" → 下次 resume 正常允许
═══════════════════════════════════════════════════════════════════════════
```
