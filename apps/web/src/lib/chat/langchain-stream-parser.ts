/**
 * LangGraph SSE → AI SDK UIMessageChunk 解析器。
 *
 * 入口：`parseLangChainPayloadToChunks`（由 `langchain-chat-transport` 按 SSE 帧调用）
 * 输出：`text-*` / `tool-input-*` / `tool-output-*` 等 chunk，供 useChat 组装 `UIMessage.parts`
 *
 * 与 UI 的衔接：
 * - `message-classifier` 将 parts 分为 thinking / tool-group / final-response 等
 * - `mergeRoutineToolGroups` 合并相邻 routine 工具行
 * - `collapseWriteTodosBlocks` 将同条消息内多次 `write_todos` 收成单块 `todo-plan`
 * - `ToolDetailPanel` + `ToolOutputViewport` 展示 stdout / CodeHighlight（StickToBottom + 虚拟化）
 *
 * 工具 input 解析要点（无 unknown_tool、DeepSeek index 错位归并）见文件末尾 ASCII 流程图。
 * 渲染流程见：`apps/web/src/components/chat/messages/MESSAGE_RENDER_FLOW.md`
 */
import { createIdGenerator, type UIMessageChunk } from "ai"

import type {
  AIMessageChunk,
  ToolMessage,
  ToolOutputData,
} from "./langchain-sse-schema"
import { LANGCHAIN_SUMMARIZATION_TEXT_PROVIDER_METADATA } from "./langchain-summarization-text"
import { resolveToolCallIdForToolOutput } from "./tool-output-routing"

const generatePartId = createIdGenerator({
  prefix: "lc-part",
  size: 16,
})

/** 进行中的工具调用：累积 args 文本，并跟踪已向 UI 下发了哪些生命周期事件 */
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
  /** 当前打开的 text 流是否与 summarization 元数据对应（用于与后续正文拆段） */
  currentTextStreamTag: "summarization" | "default" | null
  didSendFinish: boolean
  toolOutputAccumulators: Map<string, string>
  toolNamesById: Map<string, string>
  /** 当前正在执行的工具 call（tools 节点流式输出归属） */
  activeToolCallId: string | null
  /** 同一 AIMessageChunk 流内首个带 id 的工具 call（用于 index 错位的 args 片段） */
  primaryToolCallIdByMessageChunk: Map<string, string>
}

export function createLangChainStreamParseState(): LangChainStreamParseState {
  return {
    pendingToolCalls: new Map(),
    toolCallKeysById: new Map(),
    toolCallKeysByChunkIndex: new Map(),
    currentPhase: "idle",
    currentTextId: null,
    currentTextStreamTag: null,
    didSendFinish: false,
    toolOutputAccumulators: new Map(),
    toolNamesById: new Map(),
    activeToolCallId: null,
    primaryToolCallIdByMessageChunk: new Map(),
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
  state.currentTextStreamTag = null
  return chunks
}

function openNewTextPhase(
  state: LangChainStreamParseState,
  streamTag: "summarization" | "default"
): UIMessageChunk[] {
  const lifecycle: UIMessageChunk[] = closeCurrentTextPhase(state)
  const textId = transitionToTextPhase(state)
  state.currentTextStreamTag = streamTag
  const providerMetadata =
    streamTag === "summarization"
      ? LANGCHAIN_SUMMARIZATION_TEXT_PROVIDER_METADATA
      : undefined
  lifecycle.push({
    type: "text-start",
    id: textId,
    ...(providerMetadata ? { providerMetadata } : {}),
  })
  return lifecycle
}

function isLangChainAiMessageChunk(chunk: unknown): chunk is AIMessageChunk {
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

function isLangChainAiMessage(chunk: unknown): chunk is AIMessageChunk {
  if (!chunk || typeof chunk !== "object") {
    return false
  }

  const candidate = chunk as AIMessageChunk

  return (
    Array.isArray(candidate.id) &&
    candidate.id.join(".") === "langchain.schema.messages.AIMessage" &&
    candidate.type === "constructor" &&
    candidate.kwargs?.type === "ai"
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

/** resume 回放 ToolMessage 缺 name 时，仍须登记 invocation 供 useChat 消费 output */
const FALLBACK_TOOL_NAME_FOR_OUTPUT = "tool"

function resolveToolNameForInvocation(
  state: LangChainStreamParseState,
  toolCallId: string,
  hint?: string | null
): string {
  const fromHint = hint?.trim()
  if (fromHint) return fromHint

  const fromPending = resolvePendingToolCallById(state, toolCallId)?.toolName
  if (fromPending?.trim()) return fromPending.trim()

  const fromMap = state.toolNamesById.get(toolCallId)
  if (fromMap?.trim()) return fromMap.trim()

  return FALLBACK_TOOL_NAME_FOR_OUTPUT
}

/**
 * 记录同一 AIMessageChunk 流（kwargs.id）内的「主」工具 call。
 * 用于 provider 将 tool_calls 放在 index 0、tool_call_chunks 放在 index 1 时的 args 归并。
 */
function rememberPrimaryToolCallForMessage(
  state: LangChainStreamParseState,
  messageChunkId: string,
  toolCallId: string | null,
  toolName: string | null
) {
  if (!toolCallId || !toolName) return
  state.primaryToolCallIdByMessageChunk.set(messageChunkId, toolCallId)
}

/** 建立 messageChunkId:index → pending.key，供后续按 chunk index 查找 */
function linkChunkIndexToPending(
  state: LangChainStreamParseState,
  messageChunkId: string,
  index: number,
  pending: PendingToolCall
) {
  state.toolCallKeysByChunkIndex.set(
    getChunkIndexKey(messageChunkId, index),
    pending.key
  )
}

/**
 * 仅在 toolCallId + toolName 齐备时下发 tool-input-start。
 * 不使用 unknown_tool 占位，避免 UI 出现幽灵工具行。
 */
function emitToolInputStartIfReady(
  pending: PendingToolCall,
  state: LangChainStreamParseState,
  result: UIMessageChunk[]
) {
  if (pending.sentInputStart) return
  if (!pending.toolCallId || !pending.toolName) return

  result.push({
    type: "tool-input-start",
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
  })
  pending.sentInputStart = true
  state.activeToolCallId = pending.toolCallId
  state.toolNamesById.set(pending.toolCallId, pending.toolName)
}

function appendToolInputDelta(
  pending: PendingToolCall,
  inputTextDelta: string,
  state: LangChainStreamParseState,
  result: UIMessageChunk[]
) {
  emitToolInputStartIfReady(pending, state, result)
  if (!pending.sentInputStart || !pending.toolCallId || !pending.toolName) {
    pending.inputText += inputTextDelta
    emitToolInputStartIfReady(pending, state, result)
    if (!pending.sentInputStart) return
  }

  if (!pending.toolCallId || !pending.toolName) return

  const toolCallId = pending.toolCallId
  const toolName = pending.toolName

  pending.inputText += inputTextDelta

  result.push({
    type: "tool-input-delta",
    toolCallId,
    inputTextDelta,
  })

  const parsedInput = tryParseToolInput(pending.inputText)
  if (!pending.sentInputAvailable && parsedInput !== null) {
    result.push({
      type: "tool-input-available",
      toolCallId,
      toolName,
      input: parsedInput,
    })
    pending.sentInputAvailable = true
    state.activeToolCallId = toolCallId
  }
}

/**
 * 为流式 args 片段解析 pending，优先级：
 * 1. toolCallId  2. messageChunkId:index  3. 同流主工具 primaryToolCallId
 * 无 id/name 且无法归并时返回 null（丢弃噪声片段，如 "0}"）
 */
function resolvePendingForToolDelta(options: {
  state: LangChainStreamParseState
  messageChunkId: string
  indexValue: number
  toolCallId: string | null
  toolName: string | null
}): PendingToolCall | null {
  const { state, messageChunkId, indexValue, toolCallId, toolName } = options

  if (toolCallId) {
    const byId = resolvePendingToolCallById(state, toolCallId)
    if (byId) {
      linkChunkIndexToPending(state, messageChunkId, indexValue, byId)
      return byId
    }
  }

  const byChunkIndex = resolvePendingToolCallByChunkIndex(
    state,
    messageChunkId,
    indexValue
  )
  if (byChunkIndex) {
    return byChunkIndex
  }

  const primaryId =
    state.primaryToolCallIdByMessageChunk.get(messageChunkId) ?? null
  if (!toolCallId && !toolName && primaryId) {
    const byPrimary = resolvePendingToolCallById(state, primaryId)
    if (byPrimary) {
      linkChunkIndexToPending(state, messageChunkId, indexValue, byPrimary)
      return byPrimary
    }
  }

  if (!toolCallId && !toolName) {
    return null
  }

  return getOrCreatePendingToolCall({
    state,
    messageChunkId,
    index: indexValue,
    toolCallId,
    toolName,
  })
}

/** 将带 id 的 tool_call_chunks 的 index 绑定到已存在的 pending（缓解 index 错位） */
function registerToolCallChunkIndexAliases(
  chunk: AIMessageChunk,
  state: LangChainStreamParseState,
  messageChunkId: string
) {
  const toolCallChunks = Array.isArray(chunk.kwargs?.tool_call_chunks)
    ? chunk.kwargs.tool_call_chunks
    : []

  toolCallChunks.forEach((rawChunk, fallbackIndex) => {
    const toolCallChunk = rawChunk as {
      id?: string | null
      index?: number | null
    }
    const toolCallId = getStringValue(toolCallChunk.id)
    if (!toolCallId) return

    const indexValue =
      typeof toolCallChunk.index === "number"
        ? toolCallChunk.index
        : fallbackIndex

    const pending = resolvePendingToolCallById(state, toolCallId)
    if (pending) {
      linkChunkIndexToPending(state, messageChunkId, indexValue, pending)
    }
  })
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

function getLangGraphNode(payload: unknown): string | null {
  if (!Array.isArray(payload) || payload.length < 2) {
    return null
  }
  const meta = payload[1]
  if (!meta || typeof meta !== "object") {
    return null
  }
  const node = (meta as { langgraph_node?: unknown }).langgraph_node
  return typeof node === "string" ? node : null
}

function getActiveToolCallId(state: LangChainStreamParseState): string | null {
  if (state.activeToolCallId) {
    return state.activeToolCallId
  }
  let lastId: string | null = null
  for (const pending of state.pendingToolCalls.values()) {
    if (pending.toolCallId) {
      lastId = pending.toolCallId
    }
  }
  return lastId
}

function buildToolsNodeStreamingChunk(
  content: string,
  state: LangChainStreamParseState,
  toolCallId: string
): UIMessageChunk {
  const existing = state.toolOutputAccumulators.get(toolCallId) ?? ""
  const accumulated = existing + content
  state.toolOutputAccumulators.set(toolCallId, accumulated)

  return {
    type: "tool-output-available" as const,
    toolCallId,
    output: accumulated,
    preliminary: true,
  } as UIMessageChunk
}

/** LangGraph metadata：`lc_source` 如 summarization 表示会话压缩总结流 */
function getLcSource(payload: unknown): string | null {
  if (!Array.isArray(payload) || payload.length < 2) {
    return null
  }
  const meta = payload[1]
  if (!meta || typeof meta !== "object") {
    return null
  }
  const src = (meta as { lc_source?: unknown }).lc_source
  return typeof src === "string" ? src : null
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

  // (1) 完整 tool_calls：登记 id/name，建立主工具与 chunkIndex 映射
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

      if (existingPending.toolCallId && existingPending.toolName) {
        rememberPrimaryToolCallForMessage(
          state,
          messageChunkId,
          existingPending.toolCallId,
          existingPending.toolName
        )
        linkChunkIndexToPending(
          state,
          messageChunkId,
          arrayIndex,
          existingPending
        )
      }

      emitToolInputStartIfReady(existingPending, state, result)

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

    rememberPrimaryToolCallForMessage(
      state,
      messageChunkId,
      pending.toolCallId,
      pending.toolName
    )
    linkChunkIndexToPending(state, messageChunkId, arrayIndex, pending)
    emitToolInputStartIfReady(pending, state, result)
  })

  registerToolCallChunkIndexAliases(chunk, state, messageChunkId)

  const toolCallChunks = Array.isArray(chunk.kwargs?.tool_call_chunks)
    ? chunk.kwargs.tool_call_chunks
    : []
  const invalidToolCalls = Array.isArray(chunk.kwargs?.invalid_tool_calls)
    ? chunk.kwargs.invalid_tool_calls
    : []

  // (2)(3) 流式 args：优先 tool_call_chunks，否则回退 invalid_tool_calls
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
  ;[...deltas, ...fallbackDeltas].forEach((rawChunk, fallbackIndex) => {
    const toolCallChunk = rawChunk as {
      id?: string | null
      name?: string | null
      args?: string | null
      index?: number | null
    }
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

    const pending = resolvePendingForToolDelta({
      state,
      messageChunkId,
      indexValue,
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

    linkChunkIndexToPending(state, messageChunkId, indexValue, pending)

    if (toolName && !pending.toolName) {
      pending.toolName = toolName
    }

    if (pending.toolCallId && pending.toolName) {
      rememberPrimaryToolCallForMessage(
        state,
        messageChunkId,
        pending.toolCallId,
        pending.toolName
      )
    }

    appendToolInputDelta(pending, inputTextDelta, state, result)
  })

  return result
}

/**
 * 在本 SSE 连接尚未登记 toolCallId 时，先补 tool-input-start / tool-input-available。
 * HITL resume 等场景下 buffer 可能先出现 ToolMessage，updates 里的 tool_calls 又较晚到达。
 */
function ensureToolInvocationBeforeOutput(
  state: LangChainStreamParseState,
  options: {
    toolCallId: string
    toolName: string
    input?: unknown
    inputText?: string
  },
  out: UIMessageChunk[]
): PendingToolCall {
  const { toolCallId, toolName } = options
  let pending = resolvePendingToolCallById(state, toolCallId)

  if (!pending) {
    pending = getOrCreatePendingToolCall({
      state,
      messageChunkId: `resume:${toolCallId}`,
      index: 0,
      toolCallId,
      toolName,
    })
  } else if (toolName && !pending.toolName) {
    pending.toolName = toolName
  }

  if (options.inputText && !pending.inputText) {
    pending.inputText = options.inputText
  }

  emitToolInputStartIfReady(pending, state, out)

  if (!pending.sentInputAvailable && pending.toolCallId && pending.toolName) {
    const parsedInput =
      options.input ?? tryParseToolInput(pending.inputText) ?? {}
    out.push({
      type: "tool-input-available",
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      input: parsedInput,
    })
    pending.sentInputAvailable = true
    state.activeToolCallId = pending.toolCallId
  }

  return pending
}

function buildToolInputChunksFromAiMessage(
  chunk: AIMessageChunk,
  state: LangChainStreamParseState
): UIMessageChunk[] {
  const messageChunkId = chunk.kwargs?.id ?? generatePartId()
  const result: UIMessageChunk[] = []
  const toolCalls = Array.isArray(chunk.kwargs?.tool_calls)
    ? chunk.kwargs.tool_calls
    : []

  toolCalls.forEach((toolCall, arrayIndex) => {
    const toolCallId = getStringValue(toolCall.id)
    const toolName = getStringValue(toolCall.name)
    if (!toolCallId || !toolName) return

    const rawArgs = toolCall.args
    const inputText =
      typeof rawArgs === "string"
        ? rawArgs
        : rawArgs !== undefined
          ? JSON.stringify(rawArgs)
          : ""

    const pending = ensureToolInvocationBeforeOutput(
      state,
      {
        toolCallId,
        toolName,
        input:
          typeof rawArgs === "object" && rawArgs !== null ? rawArgs : undefined,
        inputText,
      },
      result
    )

    rememberPrimaryToolCallForMessage(
      state,
      messageChunkId,
      pending.toolCallId,
      pending.toolName
    )
    linkChunkIndexToPending(state, messageChunkId, arrayIndex, pending)
  })

  return result
}

function parseUpdatesPayloadToChunks(
  payload: unknown,
  state: LangChainStreamParseState
): UIMessageChunk[] {
  if (!payload || typeof payload !== "object" || !("type" in payload)) {
    return []
  }

  const obj = payload as { type: string; data: unknown }
  if (obj.type !== "updates" || !obj.data || typeof obj.data !== "object") {
    return []
  }

  const result: UIMessageChunk[] = []
  for (const nodeUpdate of Object.values(
    obj.data as Record<string, unknown>
  )) {
    if (!nodeUpdate || typeof nodeUpdate !== "object") continue
    const messages = (nodeUpdate as { messages?: unknown }).messages
    if (!Array.isArray(messages)) continue

    for (const msg of messages) {
      if (isLangChainAiMessageChunk(msg)) {
        result.push(...buildToolInputChunks(msg, state))
        continue
      }
      if (isLangChainAiMessage(msg)) {
        result.push(...buildToolInputChunksFromAiMessage(msg, state))
      }
    }
  }

  return result
}

/**
 * 根据原始载荷和当前解析状态构建工具输出消息块。
 *
 * @param payload - 待处理的原始数据载荷，预期为包含工具消息对象的数组。
 * @param state - LangChain 流式解析的状态对象，用于查找待处理的工具调用上下文。
 * @returns 0..n 个 UIMessageChunk（可能含补发的 tool-input-*）
 */
function buildToolOutputChunks(
  payload: unknown,
  state: LangChainStreamParseState
): UIMessageChunk[] {
  // 验证载荷有效性：必须是非空数组
  if (!Array.isArray(payload) || payload.length === 0) {
    return []
  }

  const chunk = payload[0]

  // 验证第一个元素是否为有效的工具消息类型
  if (!isToolMessage(chunk)) {
    return []
  }

  const toolCallId = getStringValue(chunk.kwargs?.tool_call_id)
  const toolName = getStringValue(chunk.kwargs?.name)
  const outputText =
    typeof chunk.kwargs?.content === "string" ? chunk.kwargs.content : ""
  const status = getStringValue(chunk.kwargs?.status)

  const result: UIMessageChunk[] = []

  // 处理缺失 toolCallId 的情况：若有输出文本则生成独立的消息块，否则返回 null
  if (!toolCallId) {
    if (!outputText) return []
    result.push({
      type: "tool-output-available",
      toolCallId: generatePartId(),
      output: {
        status,
        text: outputText,
        toolName,
      },
    })
    return result
  }

  let pending = resolvePendingToolCallById(state, toolCallId)
  const invocationToolName = resolveToolNameForInvocation(
    state,
    toolCallId,
    toolName
  )

  if (!pending?.sentInputStart) {
    pending = ensureToolInvocationBeforeOutput(
      state,
      {
        toolCallId,
        toolName: invocationToolName,
        input: pending ? tryParseToolInput(pending.inputText) ?? undefined : undefined,
        inputText: pending?.inputText,
      },
      result
    )
  }

  const resolvedToolName = pending?.toolName ?? invocationToolName
  const parsedInput = pending ? tryParseToolInput(pending.inputText) : null

  state.toolOutputAccumulators.delete(toolCallId)

  // 处理执行失败的状态，返回错误类型的消息块
  if (status && status !== "success") {
    result.push({
      type: "tool-output-error",
      toolCallId,
      errorText: outputText || `${resolvedToolName ?? "工具"} 执行失败`,
    })
    return result
  }

  result.push({
    type: "tool-output-available",
    toolCallId,
    output: {
      status,
      text: outputText,
      toolName: resolvedToolName,
      input: parsedInput,
      inputText: pending?.inputText ?? "",
    },
  })
  return result
}

export function buildToolOutputStreamingChunks(
  event: ToolOutputData,
  state: LangChainStreamParseState
): UIMessageChunk[] {
  const { tool_name, chunk } = event

  const toolCallId = resolveToolCallIdForToolOutput(
    {
      toolNamesById: state.toolNamesById,
      activeToolCallId: state.activeToolCallId,
    },
    tool_name,
    event.tool_call_id
  )

  if (!toolCallId) return []

  const invocationToolName = resolveToolNameForInvocation(
    state,
    toolCallId,
    tool_name
  )
  const result: UIMessageChunk[] = []

  const pending = resolvePendingToolCallById(state, toolCallId)
  if (!pending?.sentInputStart) {
    ensureToolInvocationBeforeOutput(
      state,
      { toolCallId, toolName: invocationToolName },
      result
    )
  }

  const existing = state.toolOutputAccumulators.get(toolCallId) ?? ""
  const accumulated = existing ? existing + "\n" + chunk : chunk
  state.toolOutputAccumulators.set(toolCallId, accumulated)

  result.push({
    type: "tool-output-available" as const,
    toolCallId,
    output: accumulated,
    preliminary: true,
  } as UIMessageChunk)

  return result
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
  if (
    payload &&
    typeof payload === "object" &&
    "type" in payload &&
    "data" in payload
  ) {
    const obj = payload as { type: string; data: unknown }
    if (obj.type === "messages" && Array.isArray(obj.data)) {
      return obj.data
    }
    // updates 事件不产生 UIMessageChunk，跳过
    return null
  }
  return payload
}

/** 将单条 LangGraph SSE data 解析为 0..n 个 UIMessageChunk（有状态，跨帧累积） */
export function parseLangChainPayloadToChunks(options: {
  payload: unknown
  state: LangChainStreamParseState
}): UIMessageChunk[] {
  const updateChunks = parseUpdatesPayloadToChunks(options.payload, options.state)
  if (updateChunks.length > 0) {
    return updateChunks
  }

  const rawPayload = unwrapStreamModePayload(options.payload)
  if (rawPayload === null) {
    return []
  }

  const { state } = options
  const result: UIMessageChunk[] = []
  const payload = rawPayload

  const toolOutputChunks = buildToolOutputChunks(payload, state)

  const hasToolInput =
    Array.isArray(payload) &&
    isLangChainAiMessageChunk(payload[0]) &&
    hasAnyToolDelta(payload[0])

  const hasToolContent = !!(toolOutputChunks.length > 0 || hasToolInput)
  const assistantText = extractAssistantText(payload)
  const hasTextContent = !!assistantText

  if (hasToolContent && state.currentPhase === "text") {
    result.push(...closeCurrentTextPhase(state))
    state.currentPhase = "tool"
  }

  if (toolOutputChunks.length > 0) {
    result.push(...closeCurrentTextPhase(state))
    state.currentPhase = "tool"
    state.activeToolCallId = null
    result.push(...toolOutputChunks)
  }

  if (hasToolInput) {
    state.currentPhase = "tool"
    result.push(...buildToolInputChunks(payload[0] as AIMessageChunk, state))
  }

  if (hasTextContent && assistantText) {
    const langgraphNode = getLangGraphNode(payload)

    if (langgraphNode === "tools") {
      const toolCallId = getActiveToolCallId(state)
      if (toolCallId) {
        if (state.currentPhase === "text") {
          result.push(...closeCurrentTextPhase(state))
        }
        state.currentPhase = "tool"
        result.push(
          buildToolsNodeStreamingChunk(assistantText, state, toolCallId)
        )
      } else if (import.meta.env.DEV) {
        console.warn(
          "[langchain-stream] dropped tools-node content without activeToolCallId"
        )
      }
    } else if (langgraphNode === "model" || langgraphNode === null) {
      const streamTag =
        getLcSource(payload) === "summarization" ? "summarization" : "default"
      if (
        state.currentPhase === "text" &&
        state.currentTextStreamTag !== null &&
        state.currentTextStreamTag !== streamTag
      ) {
        result.push(...closeCurrentTextPhase(state))
        state.currentPhase = "idle"
      }
      if (state.currentPhase !== "text") {
        result.push(...openNewTextPhase(state, streamTag))
      }
      const deltaChunk: UIMessageChunk = {
        type: "text-delta",
        id: state.currentTextId!,
        delta: assistantText,
      }
      if (streamTag === "summarization") {
        ;(deltaChunk as { providerMetadata?: unknown }).providerMetadata =
          LANGCHAIN_SUMMARIZATION_TEXT_PROVIDER_METADATA
      }
      result.push(deltaChunk)
    }
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

/*
 * ============================================================================
 * ASCII 解析流程（LangGraph SSE → UIMessageChunk）
 * ============================================================================
 *
 * 一、总入口 parseLangChainPayloadToChunks
 *
 *   SSE payload (v2: { type, data })
 *        |
 *        v
 *   unwrapStreamModePayload  --> 仅 type=messages 的 data 数组继续
 *        |
 *        +-- payload[0] 是 ToolMessage? -----> buildToolOutputChunks
 *        |                                      (可能先补 tool-input-*，再 tool-output-available)
 *        |
 *        +-- payload[0] 是 AIMessageChunk?
 *              |
 *              +-- hasAnyToolDelta? --> buildToolInputChunks
 *              |                        (tool-input-start/delta/available)
 *              |
 *              +-- kwargs.content 文本?
 *                    |
 *                    +-- langgraph_node=tools --> buildToolsNodeStreamingChunk
 *                    |                            (preliminary stdout 累积)
 *                    |
 *                    +-- langgraph_node=model --> text-start / text-delta
 *                                               (lc_source=summarization 可拆段)
 *
 *
 * 二、状态机（state 关键 Map）
 *
 *   pendingToolCalls          key -> PendingToolCall（累积 inputText）
 *   toolCallKeysById          toolCallId -> pending.key
 *   toolCallKeysByChunkIndex  messageChunkId:index -> pending.key
 *   primaryToolCallIdByMessageChunk
 *                             messageChunkId -> 主 toolCallId（同流 args 归并）
 *   toolNamesById             toolCallId -> toolName（tool_output 反查）
 *   toolOutputAccumulators    toolCallId -> 流式 stdout 累积文本
 *   activeToolCallId          当前归属 tools 节点输出的 call
 *
 *
 * 三、buildToolInputChunks（工具参数流）
 *
 *   AIMessageChunk (同一 kwargs.id 可跨多帧 SSE)
 *        |
 *        |  (1) tool_calls[] 完整对象
 *        v
 *   forEach arrayIndex:
 *        合并已有 pending（by id / by chunkIndex）
 *        rememberPrimaryToolCall + linkChunkIndex
 *        emitToolInputStartIfReady  （必须 id+name，无 unknown_tool）
 *        |
 *        |  (2) registerToolCallChunkIndexAliases
 *        v
 *   带 id 的 tool_call_chunks.index 绑定到 pending
 *        |
 *        |  (3) tool_call_chunks / invalid_tool_calls 的 args 字符串
 *        v
 *   resolvePendingForToolDelta:
 *        by toolCallId --> by messageChunkId:index --> by primaryToolCallId
 *        仍无 id/name --> return null（不建幽灵 pending）
 *        |
 *        v
 *   appendToolInputDelta:
 *        start（若尚未）-> delta -> JSON 可解析时 input-available
 *
 *   典型 DeepSeek 错位（已处理）:
 *
 *     帧 N   tool_calls[0]: name=ls, id=call_xxx     --> pending @ index 0
 *     帧 N+1 tool_call_chunks index=1 args="{..."   --> 归并到 primary call_xxx
 *     帧 N-1 噪声 index=0 args="0}"                  --> 丢弃（无 id/name）
 *
 *
 * 四、工具输出两条路径
 *
 *   A) messages 里的 ToolMessage
 *        buildToolOutputChunks --> tool-output-available（清除 accumulator）
 *
 *   B) artifact tool_output 事件（transport 层）
 *        buildToolOutputStreamingChunk --> tool_call_id 优先，回退 active/最后同名
 *        --> preliminary tool-output-available
 *
 *
 * 五、产出 chunk 与下游 UI
 *
 *   UIMessageChunk[]
 *        --> useChat 组装 UIMessage.parts (tool-* / text)
 *        --> classifyMessageParts
 *              --> mergeRoutineToolGroups (shell_execute / grep / ls … 紧凑组)
 *              --> collapseWriteTodosBlocks (多次 write_todos -> 单块 todo-plan)
 *        --> RenderClassifiedBlocks
 *              --> TodoPlanBlock      (任务规划，原位更新 + 可选 sticky)
 *              --> ToolGroupBlock     --> ToolActivityLine / ToolActionRow
 *              --> ToolDetailPanel    --> ToolOutputViewport (stdout 粘底/虚拟化)
 *
 *   write_todos 典型流：多帧 tool-input-available 更新同一或不同 toolCallId
 *   的 todos 列表；UI 层不按 part 平铺多张卡，而在分类后合并为首次位置的 todo-plan。
 *
 * 详见：langchain-stream-parser-flow.md、messages/MESSAGE_RENDER_FLOW.md
 * ============================================================================
 */
