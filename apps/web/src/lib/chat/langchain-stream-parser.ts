import { createIdGenerator, type UIMessageChunk } from "ai"

import type { AIMessageChunk, ToolMessage } from "./langchain-sse-schema"

const generatePartId = createIdGenerator({
  prefix: "lc-part",
  size: 16,
})

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
): chunk is AIMessageChunk {
  if (!chunk || typeof chunk !== "object") {
    return false
  }

  const candidate = chunk as AIMessageChunk

  return (
    Array.isArray(candidate.id) &&
    candidate.id.join(".") === "langchain.schema.messages.AIMessageChunk" &&
    candidate.type === "constructor" &&
    candidate.kwargs?.type === "AIMessageChunk"
  )
}

function isToolMessage(chunk: unknown): chunk is ToolMessage {
  if (!chunk || typeof chunk !== "object") {
    return false
  }

  const candidate = chunk as ToolMessage

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

/**
 * 处理 AI 消息块中的工具调用信息，生成相应的 UI 消息块。
 *
 * 该函数主要处理两类数据：
 * 1. `tool_calls`: 完整的工具调用对象，用于初始化或更新待处理的工具调用状态，并可能触发 "tool-input-start" 事件。
 * 2. `tool_call_chunks` 或 `invalid_tool_calls`: 流式的工具调用参数片段，用于累积输入文本，触发 "tool-input-delta" 和 "tool-input-available" 事件。
 *
 * @param chunk - 包含工具调用信息的 AI 消息块。
 * @param state - LangChain 流解析状态对象，用于维护待处理工具调用的上下文和映射关系。
 * @returns 生成的 UI 消息块数组，包含工具调用开始、增量输入和完整输入可用等事件。
 */
function buildToolInputChunks(
  chunk: AIMessageChunk,
  state: LangChainStreamParseState
) {
  const messageChunkId = chunk.kwargs?.id ?? generatePartId()
  const result: UIMessageChunk[] = []
  const toolCalls = Array.isArray(chunk.kwargs?.tool_calls)
    ? chunk.kwargs.tool_calls
    : []

  // 处理完整的工具调用对象，初始化或更新待处理状态，并在必要时发出开始信号
  toolCalls.forEach((toolCall, arrayIndex) => {
    const toolCallId = getStringValue(toolCall.id)
    const toolName = getStringValue(toolCall.name)

    let existingPending: PendingToolCall | null = null

    if (toolCallId) {
      existingPending = resolvePendingToolCallById(state, toolCallId)
    }

    if (!existingPending) {
      const byChunkIndex = resolvePendingToolCallByChunkIndex(
        state,
        messageChunkId,
        arrayIndex
      )
      if (
        byChunkIndex &&
        (!byChunkIndex.toolCallId || byChunkIndex.toolCallId === toolCallId)
      ) {
        existingPending = byChunkIndex
      }
    }

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
      index: arrayIndex,
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

  // 过滤出包含字符串类型参数的有效片段，若无有效片段则尝试从无效调用中获取作为后备
  const deltas = toolCallChunks.filter(
    (toolCallChunk) => typeof toolCallChunk.args === "string"
  )
  const fallbackDeltas =
    deltas.length > 0
      ? []
      : invalidToolCalls.filter(
        (toolCallChunk) => typeof toolCallChunk.args === "string"
      )

    // 处理流式工具调用参数片段，累积输入文本并生成相应的 UI 事件
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

      // 查找或创建对应的待处理工具调用对象
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

      // 如果尚未发送开始信号，且已具备必要信息，则发送工具输入开始事件
      if (!pending.sentInputStart) {
        result.push({
          type: "tool-input-start",
          toolCallId: resolvedToolCallId,
          toolName: resolvedToolName,
        })
        pending.sentInputStart = true
      }

      pending.inputText += inputTextDelta

      // 发送工具输入增量事件
      result.push({
        type: "tool-input-delta",
        toolCallId: resolvedToolCallId,
        inputTextDelta,
      })

      // 尝试解析累积的输入文本，若解析成功且尚未发送可用信号，则发送工具输入可用事件
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

/**
 * 根据原始载荷和当前解析状态构建工具输出消息块。
 *
 * @param payload - 待处理的原始数据载荷，预期为包含工具消息对象的数组。
 * @param state - LangChain 流式解析的状态对象，用于查找待处理的工具调用上下文。
 * @returns 如果成功构建则返回 UIMessageChunk 对象，否则返回 null。
 */
function buildToolOutputChunk(
  payload: unknown,
  state: LangChainStreamParseState
): UIMessageChunk | null {
  // 验证载荷有效性：必须是非空数组
  if (!Array.isArray(payload) || payload.length === 0) {
    return null
  }

  const chunk = payload[0]

  // 验证第一个元素是否为有效的工具消息类型
  if (!isToolMessage(chunk)) {
    return null
  }

  const toolCallId = getStringValue(chunk.kwargs?.tool_call_id)
  const toolName = getStringValue(chunk.kwargs?.name)
  const outputText =
    typeof chunk.kwargs?.content === "string" ? chunk.kwargs.content : ""
  const status = getStringValue(chunk.kwargs?.status)

  // 处理缺失 toolCallId 的情况：若有输出文本则生成独立的消息块，否则返回 null
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

  // 根据 toolCallId 解析待处理的工具调用上下文及输入参数
  const pending = resolvePendingToolCallById(state, toolCallId)
  const parsedInput = pending ? tryParseToolInput(pending.inputText) : null

  // 处理执行失败的状态，返回错误类型的消息块
  if (status && status !== "success") {
    return {
      type: "tool-output-error",
      toolCallId,
      errorText: outputText || `${toolName ?? "工具"} 执行失败`,
    }
  }

  // 构建并返回成功的工具输出消息块，包含解析后的输入和输出信息
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

function unwrapStreamModePayload(payload: unknown): unknown {
  // v2 格式: {type: "messages"|"updates", ns: [...], data: [...]}
  if (payload && typeof payload === "object" && "type" in payload && "data" in payload) {
    const obj = payload as { type: string; data: unknown }
    if (obj.type === "messages" && Array.isArray(obj.data)) {
      return obj.data
    }
    // updates 事件不产生 UIMessageChunk，跳过
    return null
  }
  return payload
}

export function parseLangChainPayloadToChunks(options: {
  payload: unknown
  state: LangChainStreamParseState
}): UIMessageChunk[] {
  const rawPayload = unwrapStreamModePayload(options.payload)
  if (rawPayload === null) {
    return []
  }

  const { state } = options
  const result: UIMessageChunk[] = []
  const payload = rawPayload

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
      ...buildToolInputChunks(payload[0] as AIMessageChunk, state)
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

function hasAnyToolDelta(chunk: AIMessageChunk): boolean {
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
