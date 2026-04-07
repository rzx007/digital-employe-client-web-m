import { createIdGenerator, type UIMessageChunk } from "ai"

const generatePartId = createIdGenerator({
  prefix: "lc-part",
  size: 16,
})

interface LangChainAIMessageChunk {
  id?: string[]
  type?: string
  kwargs?: {
    id?: string
    content?: unknown
    type?: string
    chunk_position?: string
    response_metadata?: {
      finish_reason?: string
    }
    tool_calls?: Array<{
      name?: unknown
      args?: unknown
      id?: unknown
      type?: unknown
    }>
    tool_call_chunks?: Array<{
      name?: unknown
      args?: unknown
      id?: unknown
      index?: unknown
      type?: unknown
    }>
    invalid_tool_calls?: Array<{
      name?: unknown
      args?: unknown
      id?: unknown
      error?: unknown
      type?: unknown
      index?: unknown
    }>
  }
}

interface LangChainToolMessage {
  id?: string[]
  type?: string
  kwargs?: {
    content?: unknown
    type?: string
    name?: unknown
    tool_call_id?: unknown
    status?: unknown
  }
}

interface PendingToolCall {
  key: string
  toolCallId: string | null
  toolName: string | null
  inputText: string
  sentInputStart: boolean
  sentInputAvailable: boolean
}

type ParsePhase = "idle" | "text" | "tool"

export interface LangChainStreamParseState {
  pendingToolCalls: Map<string, PendingToolCall>
  toolCallKeysById: Map<string, string>
  toolCallKeysByChunkIndex: Map<string, string>
  currentPhase: ParsePhase
  currentTextId: string | null
  didSendFinish: boolean
}

export function createLangChainStreamParseState(): LangChainStreamParseState {
  return {
    pendingToolCalls: new Map(),
    toolCallKeysById: new Map(),
    toolCallKeysByChunkIndex: new Map(),
    currentPhase: "idle",
    currentTextId: null,
    didSendFinish: false,
  }
}

function transitionToTextPhase(state: LangChainStreamParseState): string {
  const textId = generatePartId()
  state.currentPhase = "text"
  state.currentTextId = textId
  return textId
}

function closeCurrentTextPhase(
  state: LangChainStreamParseState
): UIMessageChunk[] {
  if (state.currentPhase !== "text" || !state.currentTextId) {
    return []
  }

  const chunks: UIMessageChunk[] = [
    { type: "text-end", id: state.currentTextId },
  ]
  state.currentPhase = "idle"
  state.currentTextId = null
  return chunks
}

function openNewTextPhase(state: LangChainStreamParseState): UIMessageChunk[] {
  const lifecycle: UIMessageChunk[] = closeCurrentTextPhase(state)
  const textId = transitionToTextPhase(state)
  lifecycle.push({ type: "text-start", id: textId })
  return lifecycle
}

function isLangChainAiMessageChunk(
  chunk: unknown
): chunk is LangChainAIMessageChunk {
  if (!chunk || typeof chunk !== "object") {
    return false
  }

  const candidate = chunk as LangChainAIMessageChunk

  return (
    Array.isArray(candidate.id) &&
    candidate.id.join(".") === "langchain.schema.messages.AIMessageChunk" &&
    candidate.type === "constructor" &&
    candidate.kwargs?.type === "AIMessageChunk"
  )
}

function isLangChainToolMessage(chunk: unknown): chunk is LangChainToolMessage {
  if (!chunk || typeof chunk !== "object") {
    return false
  }

  const candidate = chunk as LangChainToolMessage

  return (
    Array.isArray(candidate.id) &&
    candidate.id.join(".") === "langchain.schema.messages.ToolMessage" &&
    candidate.type === "constructor" &&
    candidate.kwargs?.type === "tool"
  )
}

function getStringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null
}

function getToolCallKey(options: {
  toolCallId?: string | null
  messageChunkId: string
  index: number
}) {
  if (options.toolCallId) {
    return options.toolCallId
  }

  return `${options.messageChunkId}:${options.index}`
}

function getChunkIndexKey(messageChunkId: string, index: number) {
  return `${messageChunkId}:${index}`
}

function tryParseToolInput(inputText: string) {
  if (!inputText.trim()) {
    return null
  }

  try {
    return JSON.parse(inputText) as unknown
  } catch {
    return null
  }
}

function getOrCreatePendingToolCall(options: {
  state: LangChainStreamParseState
  messageChunkId: string
  index: number
  toolCallId?: string | null
  toolName?: string | null
}) {
  const { state, messageChunkId, index } = options
  const toolCallId = options.toolCallId ?? null
  const toolName = options.toolName ?? null
  const key = getToolCallKey({ toolCallId, messageChunkId, index })
  const existing = state.pendingToolCalls.get(key)

  if (existing) {
    if (toolCallId && !existing.toolCallId) {
      existing.toolCallId = toolCallId
      state.toolCallKeysById.set(toolCallId, existing.key)
    }

    if (toolName && !existing.toolName) {
      existing.toolName = toolName
    }

    return existing
  }

  const pending: PendingToolCall = {
    key,
    toolCallId,
    toolName,
    inputText: "",
    sentInputStart: false,
    sentInputAvailable: false,
  }

  state.pendingToolCalls.set(key, pending)

  if (toolCallId) {
    state.toolCallKeysById.set(toolCallId, key)
  }

  state.toolCallKeysByChunkIndex.set(
    getChunkIndexKey(messageChunkId, index),
    key
  )

  return pending
}

function resolvePendingToolCallById(
  state: LangChainStreamParseState,
  toolCallId: string
) {
  const key = state.toolCallKeysById.get(toolCallId)

  if (!key) {
    return null
  }

  return state.pendingToolCalls.get(key) ?? null
}

function resolvePendingToolCallByChunkIndex(
  state: LangChainStreamParseState,
  messageChunkId: string,
  index: number
) {
  const key = state.toolCallKeysByChunkIndex.get(
    getChunkIndexKey(messageChunkId, index)
  )

  if (!key) {
    return null
  }

  return state.pendingToolCalls.get(key) ?? null
}

function extractAssistantText(payload: unknown) {
  if (!Array.isArray(payload) || payload.length === 0) {
    return null
  }

  const chunk = payload[0]

  if (!isLangChainAiMessageChunk(chunk)) {
    return null
  }

  const content = chunk.kwargs?.content

  if (typeof content !== "string" || content.length === 0) {
    return null
  }

  return content
}

function buildToolInputChunks(
  chunk: LangChainAIMessageChunk,
  state: LangChainStreamParseState
) {
  const messageChunkId = chunk.kwargs?.id ?? generatePartId()
  const result: UIMessageChunk[] = []
  const toolCalls = Array.isArray(chunk.kwargs?.tool_calls)
    ? chunk.kwargs.tool_calls
    : []

  toolCalls.forEach((toolCall, index) => {
    const toolCallId = getStringValue(toolCall.id)
    const toolName = getStringValue(toolCall.name)
    const existingPending = resolvePendingToolCallByChunkIndex(
      state,
      messageChunkId,
      index
    )

    if (existingPending) {
      if (toolCallId && !existingPending.toolCallId) {
        existingPending.toolCallId = toolCallId
        state.toolCallKeysById.set(toolCallId, existingPending.key)
      }

      if (toolName && !existingPending.toolName) {
        existingPending.toolName = toolName
      }

      if (
        !existingPending.sentInputStart &&
        existingPending.toolName &&
        existingPending.toolCallId
      ) {
        result.push({
          type: "tool-input-start",
          toolCallId: existingPending.toolCallId,
          toolName: existingPending.toolName,
        })
        existingPending.sentInputStart = true
      }

      return
    }

    if (!toolCallId && !toolName) {
      return
    }

    const pending = getOrCreatePendingToolCall({
      state,
      messageChunkId,
      index,
      toolCallId,
      toolName,
    })

    if (!pending.sentInputStart && pending.toolCallId && pending.toolName) {
      result.push({
        type: "tool-input-start",
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
      })
      pending.sentInputStart = true
    }
  })

  const toolCallChunks = Array.isArray(chunk.kwargs?.tool_call_chunks)
    ? chunk.kwargs.tool_call_chunks
    : []
  const invalidToolCalls = Array.isArray(chunk.kwargs?.invalid_tool_calls)
    ? chunk.kwargs.invalid_tool_calls
    : []
  const deltas = toolCallChunks.filter(
    (toolCallChunk) => typeof toolCallChunk.args === "string"
  )
  const fallbackDeltas =
    deltas.length > 0
      ? []
      : invalidToolCalls.filter(
          (toolCallChunk) => typeof toolCallChunk.args === "string"
        )

  ;[...deltas, ...fallbackDeltas].forEach((toolCallChunk, fallbackIndex) => {
    const indexValue =
      typeof toolCallChunk.index === "number"
        ? toolCallChunk.index
        : fallbackIndex
    const toolCallId = getStringValue(toolCallChunk.id)
    const toolName = getStringValue(toolCallChunk.name)
    const inputTextDelta =
      typeof toolCallChunk.args === "string" ? toolCallChunk.args : ""

    if (!inputTextDelta) {
      return
    }

    const pending =
      (toolCallId ? resolvePendingToolCallById(state, toolCallId) : null) ??
      resolvePendingToolCallByChunkIndex(state, messageChunkId, indexValue) ??
      getOrCreatePendingToolCall({
        state,
        messageChunkId,
        index: indexValue,
        toolCallId,
        toolName,
      })

    if (!pending) {
      return
    }

    if (toolCallId && !pending.toolCallId) {
      pending.toolCallId = toolCallId
      state.toolCallKeysById.set(toolCallId, pending.key)
    }

    state.toolCallKeysByChunkIndex.set(
      getChunkIndexKey(messageChunkId, indexValue),
      pending.key
    )

    if (toolName && !pending.toolName) {
      pending.toolName = toolName
    }

    const resolvedToolCallId = pending.toolCallId ?? pending.key
    const resolvedToolName = pending.toolName ?? "unknown_tool"

    if (!pending.sentInputStart) {
      result.push({
        type: "tool-input-start",
        toolCallId: resolvedToolCallId,
        toolName: resolvedToolName,
      })
      pending.sentInputStart = true
    }

    pending.inputText += inputTextDelta

    result.push({
      type: "tool-input-delta",
      toolCallId: resolvedToolCallId,
      inputTextDelta,
    })

    const parsedInput = tryParseToolInput(pending.inputText)
    if (!pending.sentInputAvailable && parsedInput !== null) {
      result.push({
        type: "tool-input-available",
        toolCallId: resolvedToolCallId,
        toolName: resolvedToolName,
        input: parsedInput,
      })
      pending.sentInputAvailable = true
    }
  })

  return result
}

function buildToolOutputChunk(
  payload: unknown,
  state: LangChainStreamParseState
): UIMessageChunk | null {
  if (!Array.isArray(payload) || payload.length === 0) {
    return null
  }

  const chunk = payload[0]

  if (!isLangChainToolMessage(chunk)) {
    return null
  }

  const toolCallId = getStringValue(chunk.kwargs?.tool_call_id)
  const toolName = getStringValue(chunk.kwargs?.name)
  const outputText =
    typeof chunk.kwargs?.content === "string" ? chunk.kwargs.content : ""
  const status = getStringValue(chunk.kwargs?.status)

  if (!toolCallId) {
    return outputText
      ? {
          type: "tool-output-available",
          toolCallId: generatePartId(),
          output: {
            status,
            text: outputText,
            toolName,
          },
        }
      : null
  }

  const pending = resolvePendingToolCallById(state, toolCallId)
  const parsedInput = pending ? tryParseToolInput(pending.inputText) : null

  if (status && status !== "success") {
    return {
      type: "tool-output-error",
      toolCallId,
      errorText: outputText || `${toolName ?? "工具"} 执行失败`,
    }
  }

  return {
    type: "tool-output-available",
    toolCallId,
    output: {
      status,
      text: outputText,
      toolName: toolName ?? pending?.toolName ?? null,
      input: parsedInput,
      inputText: pending?.inputText ?? "",
    },
  }
}

export function closeTextPhaseIfNeeded(
  state: LangChainStreamParseState
): UIMessageChunk[] {
  return closeCurrentTextPhase(state)
}

export function enqueueFinish(
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  state: LangChainStreamParseState
) {
  if (state.didSendFinish) {
    return
  }

  controller.enqueue({ type: "finish", finishReason: "stop" })
  state.didSendFinish = true
}

export function parseLangChainPayloadToChunks(options: {
  payload: unknown
  state: LangChainStreamParseState
}): UIMessageChunk[] {
  const { payload, state } = options
  const result: UIMessageChunk[] = []

  const toolOutputChunk = buildToolOutputChunk(payload, state)

  const hasToolInput =
    Array.isArray(payload) &&
    isLangChainAiMessageChunk(payload[0]) &&
    hasAnyToolDelta(payload[0])

  const hasToolContent = !!(toolOutputChunk || hasToolInput)
  const assistantText = extractAssistantText(payload)
  const hasTextContent = !!assistantText

  if (hasToolContent && state.currentPhase === "text") {
    result.push(...closeCurrentTextPhase(state))
    state.currentPhase = "tool"
  }

  if (toolOutputChunk) {
    state.currentPhase = "tool"
    result.push(toolOutputChunk)
  }

  if (hasToolInput) {
    state.currentPhase = "tool"
    result.push(
      ...buildToolInputChunks(payload[0] as LangChainAIMessageChunk, state)
    )
  }

  if (hasTextContent) {
    if (state.currentPhase !== "text") {
      result.push(...openNewTextPhase(state))
    }
    result.push({
      type: "text-delta",
      id: state.currentTextId!,
      delta: assistantText,
    })
  }

  return result
}

function hasAnyToolDelta(chunk: LangChainAIMessageChunk): boolean {
  const toolCalls = Array.isArray(chunk.kwargs?.tool_calls)
    ? chunk.kwargs.tool_calls
    : []
  const toolCallChunks = Array.isArray(chunk.kwargs?.tool_call_chunks)
    ? chunk.kwargs.tool_call_chunks
    : []
  const invalidToolCalls = Array.isArray(chunk.kwargs?.invalid_tool_calls)
    ? chunk.kwargs.invalid_tool_calls
    : []

  const hasCalls = toolCalls.some(
    (tc) => getStringValue(tc.id) || getStringValue(tc.name)
  )

  const hasDeltas = toolCallChunks.some(
    (tcc) => typeof tcc.args === "string" && tcc.args.length > 0
  )

  const hasFallbackDeltas = invalidToolCalls.some(
    (itc) => typeof itc.args === "string" && itc.args.length > 0
  )

  return hasCalls || hasDeltas || hasFallbackDeltas
}
