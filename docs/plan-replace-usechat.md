# 计划：摒弃 useChat，改为手动管理聊天流式状态

## 1. 问题背景

当前使用 `@ai-sdk/react` 的 `useChat` hook 管理聊天消息状态。`useChat` 内部通过 `UIMessageChunk` 事件流驱动 `UIMessage.parts` 的更新。后端新增了 `tool_output` SSE 事件（execute 命令的逐行 stdout），但 `useChat` 的 `UIMessageChunk` 类型体系中没有 `tool-output-delta` 这类增量输出类型，导致无法将流式工具输出注入到 tool part 中。

**核心矛盾**：`useChat` 是一个黑盒，它内部管理 `UIMessage.parts` 的生命周期，外部只能通过 `ChatTransport` 发射 `UIMessageChunk` 事件来间接控制。而 `tool_output` 事件不属于 `UIMessageChunk` 规范，无法被 `useChat` 理解和消化。

**决策**：完全摒弃 `useChat`，自建 `useChatStream` hook，直接管理 SSE 流和消息状态，获得对 `tool_output` 事件的完整控制。

---

## 2. 当前架构

```
用户发送消息
    ↓
useChat.sendMessage()
    ↓
LangChainChatTransport.sendMessages()
    ↓ POST /chat/conversations/{id}/stream
SSE byte stream
    ↓ processResponseStream()
SSE text events → sseEventSchema 验证
    ↓ parseLangChainPayloadToChunks()
UIMessageChunk[] (text-delta, tool-input-start, tool-output-available, ...)
    ↓ useChat 内部黑盒
UIMessage.parts[] 更新
    ↓ React re-render
ChatPanel → classifyMessageParts() → ToolGroupBlock → ToolActionRow
```

**问题点**：`tool_output` 事件无法进入 UIMessageChunk 体系，被 `unwrapStreamModePayload()` 静默丢弃。即使通过外部 handler 注入 React state，也无法与 `useChat` 的内部 parts 状态协调。

---

## 3. 目标架构

```
用户发送消息
    ↓
useChatStream.sendMessage()
    ↓ POST /chat/conversations/{id}/stream
SSE byte stream
    ↓ useChatStream 内部 processSSEStream()
SSE text events → sseEventSchema 验证
    ↓ 直接解析为 parts 更新操作
直接更新 streamingMessage.parts[]
    ↓ React setState
ChatPanel → classifyMessageParts() → ToolGroupBlock → ToolActionRow
```

**关键改进**：
- SSE 事件直接映射为 `UIMessage.parts` 的增删改，不经过 `UIMessageChunk` 中间层
- `tool_output` 事件直接更新对应 tool part 的 `streamingOutput` 属性
- 消息状态完全由我们的代码控制，不再有黑盒

---

## 4. 数据类型设计

### 4.1 扩展的 Tool Part（兼容现有渲染管线）

保持与现有 `UIMessage.parts` 类型兼容，在 tool part 的 output 中增加 `streamingOutput` 字段：

```typescript
// 工具运行中的 part
{
  type: "tool-execute",
  toolCallId: "call_xxx",
  state: "input-available",           // 工具已接收输入，正在执行
  input: { command: "python ..." },
  output: {
    streamingOutput: "=== 脚本开始 ===\n开始时间: ..."  // ← 新增：累积的 stdout
  }
}

// 工具完成的 part（最终状态）
{
  type: "tool-execute",
  toolCallId: "call_xxx",
  state: "output-available",
  input: { command: "python ..." },
  output: {
    text: "=== 脚本开始 ===\n...\n=== 脚本结束 ===",
    status: "success"
    // streamingOutput 字段不再存在
  }
}
```

### 4.2 内部状态类型

```typescript
interface ChatStreamState {
  messages: UIMessage[]
  status: "ready" | "submitted" | "streaming" | "error"
  error: Error | undefined
}
```

### 4.3 SSE 事件到 Parts 的映射规则

| SSE 事件 | Parts 操作 |
|----------|-----------|
| `messages` + AIMessageChunk(text) | 追加/更新当前文本 part（state: "streaming"） |
| `messages` + AIMessageChunk(tool_calls) | 新增 tool part（state: "input-streaming"） |
| `messages` + AIMessageChunk(tool_call_chunks) | 更新 tool part 的 inputText/input |
| `messages` + ToolMessage | 更新 tool part state → "output-available"，设置 output |
| `tool_output` | 更新对应 tool part 的 output.streamingOutput |
| `artifact` | 回调 artifactHandler |
| `updates` | 忽略 |
| `[DONE]` | 所有 text parts state → "done"，status → "ready" |

---

## 5. 文件变更清单

### 5.1 新建文件

| 文件 | 用途 |
|------|------|
| `apps/web/src/hooks/use-chat-stream.ts` | **核心**：自定义 hook，替代 `useChat` |
| `apps/web/src/lib/chat/sse-parts-builder.ts` | SSE 事件 → parts 增量更新逻辑（从 parser 简化而来） |

### 5.2 修改文件

| 文件 | 改动说明 |
|------|---------|
| `apps/web/src/components/chat/chat-conversation-view.tsx` | `useChat` → `useChatStream` |
| `apps/web/src/components/chat/chat-draft-view.tsx` | `useChat` → `useChatStream` |
| `apps/web/src/components/chat/tool-action-row.tsx` | 读取 part.output.streamingOutput 展示流式输出 |
| `apps/web/src/components/chat/message-classifier.ts` | 无变更（已兼容） |

### 5.3 可简化文件（后续可选清理）

| 文件 | 说明 |
|------|------|
| `apps/web/src/lib/chat/langchain-chat-transport.ts` | 不再需要 ChatTransport/UIMessageChunk 层，可大幅简化或移除 |
| `apps/web/src/lib/chat/langchain-stream-parser.ts` | 历史消息 replay 仍需要，保留但可精简 |
| `apps/web/src/components/chat/chat-panel.tsx` | 移除 ToolOutputStreamingHandler 相关代码 |
| `apps/web/src/components/chat/tool-group-block.tsx` | 移除 streamingTexts prop 传递 |
| `apps/web/src/components/chat/chat-view-shared.ts` | 移除 setToolOutputHandler |

### 5.4 不变文件

| 文件 | 说明 |
|------|------|
| `apps/web/src/lib/chat/langchain-sse-schema.ts` | SSE Zod schema 保持不变 |
| `apps/web/src/lib/chat/message-utils.ts` | mapStoredMessagesToUIMessages 保持不变 |
| `apps/web/src/lib/chat/tool-summarizer.ts` | 保持不变 |
| `apps/web/src/lib/chat/message-classifier.ts` | 保持不变 |
| `apps/web/src/lib/chat/artifact-utils.ts` | 保持不变 |
| `apps/web/src/api/conversation.ts` | 保持不变 |
| `apps/web/src/api/chat.ts` | 保持不变 |
| `apps/web/src/hooks/use-chat-queries.ts` | 保持不变 |
| `apps/web/src/stores/chat-store.ts` | 保持不变 |

---

## 6. 详细实现步骤

### Phase 1：新建 `sse-parts-builder.ts`

**文件**：`apps/web/src/lib/chat/sse-parts-builder.ts`

**职责**：将单个 SSE 事件映射为对 `UIMessage.parts[]` 的增量更新操作。

**核心逻辑**：

```
输入：当前 parts[], SSE event payload
输出：更新后的 parts[]
```

需要维护的内部状态（类似当前的 `LangChainStreamParseState`）：

```typescript
interface PartsBuilderState {
  // 当前活跃的文本 part 索引（用于追加 text-delta）
  currentTextPartIndex: number | null
  // 按 toolCallId 索引的 tool part 位置（用于快速查找更新）
  toolPartIndices: Map<string, number>
  // tool_call_chunks 的累积输入（在 input-available 之前持续累积）
  toolInputAccumulators: Map<string, string>
  // tool_output 的累积输出
  toolStreamingOutputs: Map<string, string>
}
```

**处理各事件类型**：

#### `messages` + AIMessageChunk (有 content)
- 如果 `currentTextPartIndex === null`：新增 `{ type: "text", text: content, state: "streaming" }` part
- 否则：追加 content 到 `parts[currentTextPartIndex].text`

#### `messages` + AIMessageChunk (有 tool_calls / tool_call_chunks)
- 解析 tool_call 信息（复用现有 `buildToolInputChunks` 的逻辑思路）
- 如果是新 tool call：
  - 关闭当前文本 part（state → "streaming" 暂不处理，最后统一设 done）
  - 新增 `{ type: "tool-{name}", toolCallId, state: "input-streaming", input: "" }` part
  - 记录到 `toolPartIndices` 和 `toolInputAccumulators`
- 如果是 tool_call_chunk（增量参数）：
  - 累积到 `toolInputAccumulators[toolCallId]`
  - 尝试 JSON.parse，成功则更新 part.input 和 part.state → "input-available"

#### `messages` + ToolMessage
- 通过 `tool_call_id` 找到对应 tool part
- 更新 state → "output-available"，设置 output
- 清理 `toolStreamingOutputs[toolCallId]`（如果有）

#### `tool_output` 事件
- 通过 `tool_name` 找到最新的匹配 tool part
- 累积 chunk 到 `toolStreamingOutputs[toolCallId]`
- 更新 tool part 的 `output.streamingOutput` 为累积文本

#### `updates` 事件
- 忽略（与渲染无关）

#### `[DONE]`
- 所有 state === "streaming" 的 text parts → state: "done"

**关键**：每次调用返回新的 parts 数组（不可变更新），触发 React re-render。

### Phase 2：新建 `use-chat-stream.ts`

**文件**：`apps/web/src/hooks/use-chat-stream.ts`

**API 签名**：

```typescript
interface UseChatStreamOptions {
  id: string
  initialMessages?: UIMessage[]
  resume?: boolean
  onError?: (error: Error) => void
  onFinish?: () => void
}

interface UseChatStreamReturn {
  messages: UIMessage[]
  setMessages: (msgs: UIMessage[] | ((prev: UIMessage[]) => UIMessage[])) => void
  sendMessage: (message: { text: string }, options?: {
    body?: Record<string, unknown>
  }) => Promise<void>
  status: "ready" | "submitted" | "streaming" | "error"
  error: Error | undefined
  stop: () => void
}

function useChatStream(options: UseChatStreamOptions): UseChatStreamReturn
```

**内部实现**：

```typescript
function useChatStream(options) {
  const [messages, setMessages] = useState(options.initialMessages ?? [])
  const [status, setStatus] = useState<ChatStatus>("ready")
  const [error, setError] = useState<Error>()
  const abortRef = useRef<AbortController | null>(null)
  const partsBuilderRef = useRef<PartsBuilderState>(createPartsBuilderState())
  const artifactHandlerRef = useRef<ArtifactEventHandler>()

  // 注册 artifact handler 的方法
  const setArtifactHandler = useCallback((handler) => {
    artifactHandlerRef.current = handler
  }, [])

  // 核心：处理 SSE 流
  const processSSEStream = useCallback(async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // 拆分 SSE events
        while (true) {
          const sepIdx = getEventBoundaryIndex(buffer)
          if (sepIdx < 0) break

          const eventText = buffer.slice(0, sepIdx)
          buffer = buffer.slice(sepIdx + getEventBoundaryLength(buffer, sepIdx))

          // 解析并处理单个 SSE event
          const event = parseSSEEvent(eventText)  // JSON.parse + sseEventSchema
          if (!event) continue

          if (event === "[DONE]") {
            // 标记所有流式文本为 done
            setMessages(prev => finalizeStreamingParts(prev, partsBuilderRef.current))
            setStatus("ready")
            return
          }

          // 根据 event type 更新 parts
          setMessages(prev => {
            const newParts = applySSEEventToParts(
              prev,
              event,
              partsBuilderRef.current,
              {
                onArtifact: (data) => artifactHandlerRef.current?.(data),
              }
            )
            // 更新最后一条 assistant message 的 parts
            return updateLastAssistantParts(prev, newParts)
          })
        }
      }

      // 流意外结束（无 [DONE]）
      setMessages(prev => finalizeStreamingParts(prev, partsBuilderRef.current))
      setStatus("ready")
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      setError(err instanceof Error ? err : new Error(String(err)))
      setStatus("error")
    } finally {
      reader.releaseLock()
    }
  }, [])

  // 发送消息
  const sendMessage = useCallback(async (message, sendOptions) => {
    const body = sendOptions?.body ?? {}
    const conversationId = body.conversationId
    const skill = body.skill ?? ""
    const metadata = body.metadata

    if (!conversationId) throw new Error("缺少会话 ID")

    // 1. 添加 user message
    const userMsg: UIMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      parts: [{ type: "text", text: message.text, state: "done" }],
    }
    if (metadata) {
      (userMsg as any).metadata = metadata
    }

    // 2. 创建空的 assistant message（占位）
    const assistantMsg: UIMessage = {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      parts: [],
    }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setStatus("submitted")

    // 3. 重置 parts builder
    partsBuilderRef.current = createPartsBuilderState()

    // 4. 发起 SSE 连接
    const ac = new AbortController()
    abortRef.current = ac

    try {
      const response = await request.raw(
        `/chat/conversations/${conversationId}/stream`,
        {
          method: "POST",
          body: JSON.stringify({
            question: message.text,
            skill,
            extra_meta: metadata,
          }),
          signal: ac.signal,
        }
      )

      if (!response.ok) throw new Error(`请求失败 (${response.status})`)
      if (!response.body) throw new Error("响应为空")

      setStatus("streaming")
      await processSSEStream(response.body)
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      const error = err instanceof Error ? err : new Error(String(err))
      setError(error)
      setStatus("error")
      options.onError?.(error)
    }
  }, [processSSEStream, options.onError])

  // 停止流
  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setMessages(prev => finalizeStreamingParts(prev, partsBuilderRef.current))
    setStatus("ready")
  }, [])

  // Resume 功能
  useEffect(() => {
    if (!options.resume || !options.id) return

    const resumeStream = async () => {
      try {
        const response = await request.raw(
          `/chat/conversations/${options.id}/stream/resume`,
          { method: "GET", headers: { Accept: "text/event-stream" } }
        )
        if (response.status === 204) return
        if (!response.ok || !response.body) return

        // 创建空的 assistant message 占位
        setMessages(prev => {
          const lastMsg = prev[prev.length - 1]
          if (lastMsg?.role === "assistant") return prev
          return [...prev, {
            id: `assistant-resume-${Date.now()}`,
            role: "assistant",
            parts: [],
          }]
        })

        partsBuilderRef.current = createPartsBuilderState()
        setStatus("streaming")
        await processSSEStream(response.body)
      } catch {}
    }

    resumeStream()
  }, [options.resume, options.id])

  // 同步 initialMessages
  useEffect(() => {
    if (options.initialMessages && options.initialMessages.length > 0) {
      setMessages(options.initialMessages)
    }
  }, [options.id]) // 当 conversationId 变化时重置

  return { messages, setMessages, sendMessage, status, error, stop, setArtifactHandler }
}
```

### Phase 3：更新 View 组件

#### 3.1 `chat-conversation-view.tsx`

```diff
- import { useChat } from "@ai-sdk/react"
- import type { UIMessage } from "ai"
+ import type { UIMessage } from "ai"

+ import { useChatStream } from "@/hooks/use-chat-stream"

- const { messages, setMessages, sendMessage, status, error, stop } = useChat({
-   id: String(conversationId),
-   messages: initialMessages,
-   transport: chatTransport,
-   resume: true,
-   onFinish: () => { ... },
-   onError: (chatError) => { ... },
- })

+ const {
+   messages,
+   setMessages,
+   sendMessage,
+   status,
+   error,
+   stop,
+   setArtifactHandler: setStreamArtifactHandler,
+ } = useChatStream({
+   id: String(conversationId),
+   initialMessages,
+   resume: true,
+   onError: (chatError) => { ... },
+ })
```

注意：`sendMessage` 的调用签名需要适配。当前调用：
```typescript
await sendMessage({ text: messageText }, { body: { conversationId, skill, metadata } })
```
新 hook 的 `sendMessage` 保持同样的签名。

#### 3.2 `chat-draft-view.tsx`

类似的替换，但不需要 `resume` 功能。

#### 3.3 artifact handler 注册

原来在 `ChatPanel` 中通过 `chatTransport.setArtifactHandler()` 注册。新架构中，`useChatStream` 返回 `setArtifactHandler` 方法，需要在 view 组件中传递给 `ChatPanel`。

方案：在 `ChatPanel` props 中增加 `onRegisterArtifactHandler` 回调，view 组件调用它注册 handler。

或者更简单：`ChatPanel` 继续直接使用全局 `chatTransport.setArtifactHandler()`，因为 artifact 事件处理与消息状态无关。

### Phase 4：更新渲染组件

#### 4.1 `tool-action-row.tsx`

从 tool part 的 output 中读取 `streamingOutput`：

```typescript
// 提取流式输出文本
function getStreamingOutput(part: Record<string, unknown>): string | null {
  const output = part.output
  if (!output || typeof output !== "object") return null
  const obj = output as Record<string, unknown>
  if (typeof obj.streamingOutput === "string" && obj.streamingOutput) {
    return obj.streamingOutput
  }
  return null
}
```

在 `ToolGroupBlock` 中，从 `tool.part` 读取流式输出并传递给 `ToolActionRow`：

```typescript
const streamingOutput = getStreamingOutput(tool.part as Record<string, unknown>)
```

移除之前的 `streamingOutputText` prop 方案，改为直接从 tool part 的数据中读取。

#### 4.2 `tool-group-block.tsx`

移除 `streamingTexts` prop，改为在 `ToolGroupItem` 上读取 part 的 `output.streamingOutput`。

#### 4.3 `chat-panel.tsx`

移除 `toolOutputStreaming` state 和 `setToolOutputHandler` 相关代码。流式输出数据现在直接存储在 `UIMessage.parts` 中，由 `message-classifier.ts` 提取。

### Phase 5：清理

#### 5.1 `chat-view-shared.ts`

- 移除 `setToolOutputHandler`
- 可以保留 `chatTransport` 单例（artifact handler 仍需要），但不再需要 `ChatTransport` 接口

#### 5.2 `langchain-chat-transport.ts`

此文件可以大幅简化。核心保留：
- `createEventSourceResponse()` — SSE 连接创建
- `createResumeEventSourceResponse()` — resume 连接创建
- `artifactHandler` 机制

可以移除：
- `ChatTransport` 接口实现（`sendMessages`, `reconnectToStream`）
- `processResponseStream()` — SSE 解析逻辑移入 `useChatStream`
- `UIMessageChunk` 发射逻辑

#### 5.3 `langchain-stream-parser.ts`

保留，仅用于历史消息 `chunk_json` 回放。`replayChunkJsonToParts()` 和 `accumulateChunksToParts()` 仍然依赖此文件的 `parseLangChainPayloadToChunks()`。

---

## 7. SSE 解析核心逻辑详细设计

### `applySSEEventToParts()` 伪代码

```typescript
function applySSEEventToParts(
  prevMessages: UIMessage[],
  event: SSEEvent,
  state: PartsBuilderState,
  callbacks: { onArtifact: (data: ArtifactData) => void }
): UIMessage["parts"] | null {
  // 返回 null 表示无需更新 parts

  switch (event.type) {
    case "messages": {
      const data = event.data  // [MessageChunk, Metadata]
      const chunk = data[0]

      if (isAIMessageChunk(chunk)) {
        const text = chunk.kwargs?.content
        const parts: UIMessage["parts"] = []

        // 1) 处理文本内容
        if (text) {
          if (state.currentTextPartIndex === null) {
            // 新增文本 part
            parts.push({ type: "text", text, state: "streaming" })
            state.currentTextPartIndex = lastAssistantMsg.parts.length
          } else {
            // 追加到现有文本 part
            const existingPart = lastAssistantMsg.parts[state.currentTextPartIndex]
            existingPart.text += text
          }
        }

        // 2) 处理工具调用
        const toolCalls = chunk.kwargs?.tool_calls ?? []
        const toolCallChunks = chunk.kwargs?.tool_call_chunks ?? []
        const invalidToolCalls = chunk.kwargs?.invalid_tool_calls ?? []

        // ... 累积 tool input，更新 parts
        // 逻辑复用 buildToolInputChunks 的思路
      }

      if (isToolMessage(chunk)) {
        // 更新 tool part state → output-available
        const toolCallId = chunk.kwargs?.tool_call_id
        const output = chunk.kwargs?.content
        // ... 找到对应 tool part，更新 state 和 output
        // ... 清理 toolStreamingOutputs[toolCallId]
      }

      return updatedParts
    }

    case "tool_output": {
      const { tool_name, chunk, chunk_seq } = event.data
      // 找到最近的匹配 tool part
      const toolCallId = findLatestToolPartByToolName(state, tool_name)
      if (!toolCallId) return null

      // 累积 streaming output
      const existing = state.toolStreamingOutputs.get(toolCallId) ?? ""
      const accumulated = existing ? existing + "\n" + chunk : chunk
      state.toolStreamingOutputs.set(toolCallId, accumulated)

      // 更新对应 tool part 的 output.streamingOutput
      // 返回更新后的 parts
      return updateToolPartStreamingOutput(parts, toolCallId, accumulated)
    }

    case "artifact": {
      callbacks.onArtifact(event.data)
      return null
    }

    case "updates": {
      return null  // 忽略
    }

    default:
      return null
  }
}
```

### `finalizeStreamingParts()`

```typescript
function finalizeStreamingParts(
  messages: UIMessage[],
  state: PartsBuilderState
): UIMessage[] {
  return messages.map(msg => {
    if (msg.role !== "assistant") return msg
    return {
      ...msg,
      parts: msg.parts.map(part => {
        if (part.type === "text" && part.state === "streaming") {
          return { ...part, state: "done" as const }
        }
        return part
      }),
    }
  })
}
```

---

## 8. 风险与注意事项

### 8.1 消息 ID 一致性

`useChat` 会为每条消息生成 ID。新 hook 需要生成类似格式的 ID，确保与后端存储的消息 ID 不冲突。建议：
- User message：前端生成临时 ID（`user-${timestamp}`）
- Assistant message：前端生成临时 ID（`assistant-${timestamp}`），在流完成后可能被后端持久化

### 8.2 Resume 功能

`ConversationChatView` 使用 `resume: true` 恢复中断的流。新 hook 需要实现：
- Mount 时检查是否有活跃的 SSE 流
- 如果有，创建空的 assistant message 占位并开始消费流

### 8.3 历史消息兼容

`mapStoredMessagesToUIMessages()` 通过 `replayChunkJsonToParts()` 重建历史消息的 parts。这个逻辑依赖 `langchain-stream-parser.ts`，与 `useChat` 无关，**不受影响**。

### 8.4 多工具并行

当前后端支持单次多工具调用（如同时读取多个文件）。`sse-parts-builder.ts` 需要正确处理多个 tool call 并行的情况——每个 tool call 有独立的 `toolCallId`，各自的 streaming output 互不干扰。

### 8.5 Abort 处理

`stop()` 需要立即终止 SSE 连接并固化当前消息状态。`AbortController` 的 abort 信号需正确传递到 fetch 请求。

### 8.6 性能考虑

- 每个 SSE event 触发一次 `setMessages` 调用 → React re-render
- `tool_output` 事件可能很频繁（每行一个），考虑使用 `requestAnimationFrame` 或批量更新
- 建议：对于 `tool_output` 事件，使用 `flushSync` 或 RAF 节流，避免每个 chunk 都触发完整渲染

### 8.7 状态同步

当 `conversationId` 变化时（用户切换会话），需要：
1. 重置 `status` 为 "ready"
2. 用新会话的 `initialMessages` 替换 `messages`
3. 取消任何正在进行的流

---

## 9. 实施顺序

```
Step 1: 新建 sse-parts-builder.ts（独立模块，可单独测试）
Step 2: 新建 use-chat-stream.ts（依赖 Step 1）
Step 3: 修改 chat-conversation-view.tsx（替换 useChat → useChatStream）
Step 4: 修改 chat-draft-view.tsx（同上）
Step 5: 修改 chat-panel.tsx（移除 ToolOutputStreamingHandler 相关代码）
Step 6: 修改 tool-group-block.tsx（移除 streamingTexts，改为从 part 读取）
Step 7: 修改 tool-action-row.tsx（从 part.output.streamingOutput 读取流式文本）
Step 8: 简化 chat-view-shared.ts（移除 setToolOutputHandler）
Step 9: 简化 langchain-chat-transport.ts（移除 ChatTransport 实现）
Step 10: 测试验证
```

每一步完成后运行 `tsc --noEmit` 验证类型正确性。

---

## 10. 验证清单

- [ ] 发送纯文本消息，收到正常文本回复
- [ ] 发送触发工具调用的消息，工具显示正确（read_file, write_file, edit_file, execute, ls）
- [ ] execute 工具执行时，实时显示逐行 stdout 输出
- [ ] 工具完成后，流式输出消失，显示最终结果
- [ ] 多工具并行调用正确展示
- [ ] 切换会话后，消息正确加载
- [ ] 页面刷新后，resume 功能正常
- [ ] 发送过程中点击停止，流正确终止
- [ ] artifact 事件正确触发 artifact 面板
- [ ] 新建对话（draft → conversation）流程正常
