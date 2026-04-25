import type { UIMessage } from "ai"

import type {
  AIMessageChunk,
  ArtifactData,
  SSEEvent,
  ToolMessage,
} from "./langchain-sse-schema"

type AnyPart = UIMessage["parts"][number]

function getStringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null
}

function isAIMessageChunk(chunk: unknown): chunk is AIMessageChunk {
  if (!chunk || typeof chunk !== "object") return false
  const c = chunk as AIMessageChunk
  return (
    Array.isArray(c.id) &&
    c.id.join(".") === "langchain.schema.messages.AIMessageChunk" &&
    c.type === "constructor" &&
    c.kwargs?.type === "AIMessageChunk"
  )
}

function isToolMessage(chunk: unknown): chunk is ToolMessage {
  if (!chunk || typeof chunk !== "object") return false
  const c = chunk as ToolMessage
  return (
    Array.isArray(c.id) &&
    c.id.join(".") === "langchain.schema.messages.ToolMessage" &&
    c.type === "constructor" &&
    c.kwargs?.type === "tool"
  )
}

function tryParseJSON(text: string): unknown {
  if (!text.trim()) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export interface PartsBuilderState {
  currentTextPartIndex: number | null
  toolPartIndicesByCallId: Map<string, number>
  toolInputAccumulators: Map<string, string>
  toolInputParsed: Map<string, unknown>
  toolNamesByCallId: Map<string, string>
  toolStreamingOutputs: Map<string, string>
  pendingToolCallsByChunkKey: Map<string, { toolCallId: string; toolName: string }>
  messageChunkIdToPending: Map<string, string>
}

export function createPartsBuilderState(): PartsBuilderState {
  return {
    currentTextPartIndex: null,
    toolPartIndicesByCallId: new Map(),
    toolInputAccumulators: new Map(),
    toolInputParsed: new Map(),
    toolNamesByCallId: new Map(),
    toolStreamingOutputs: new Map(),
    pendingToolCallsByChunkKey: new Map(),
    messageChunkIdToPending: new Map(),
  }
}

type ToolPart = Extract<AnyPart, { type: `tool-${string}`; toolCallId: string }>

function isToolPart(part: AnyPart): part is ToolPart {
  return part?.type?.startsWith("tool-") && "toolCallId" in part
}

function cloneParts(parts: AnyPart[]): AnyPart[] {
  return parts.map((p) => {
    if (p.type === "text") return { ...p }
    if (isToolPart(p)) return { ...p }
    return { ...p }
  })
}

function resolveToolCallId(
  state: PartsBuilderState,
  messageChunkId: string,
  index: number,
  toolCallId?: string | null,
  toolName?: string | null
): string | null {
  if (toolCallId) {
    const existingKey = state.pendingToolCallsByChunkKey.get(toolCallId)
    if (existingKey) return existingKey

    state.pendingToolCallsByChunkKey.set(toolCallId, toolCallId)
    if (toolName) state.toolNamesByCallId.set(toolCallId, toolName)
    return toolCallId
  }

  const chunkKey = `${messageChunkId}:${index}`

  const mapped = state.messageChunkIdToPending.get(chunkKey)
  if (mapped) return mapped

  const tempId = `pending:${chunkKey}`
  state.messageChunkIdToPending.set(chunkKey, tempId)
  state.pendingToolCallsByChunkKey.set(tempId, tempId)
  if (toolName) state.toolNamesByCallId.set(tempId, toolName)
  return tempId
}

function findToolCallIdByToolName(
  state: PartsBuilderState,
  toolName: string
): string | null {
  for (const [callId, name] of state.toolNamesByCallId) {
    if (name === toolName) return callId
  }
  return null
}

export interface SSEPartsResult {
  parts: AnyPart[]
  artifactData?: ArtifactData
}

export function applySSEEventToParts(
  currentParts: AnyPart[],
  event: SSEEvent,
  state: PartsBuilderState
): SSEPartsResult | null {
  if (!event || typeof event !== "object" || !("type" in event)) return null

  const eventType = (event as { type: string }).type

  if (eventType === "artifact" && "data" in event) {
    return { parts: currentParts, artifactData: (event as { data: unknown }).data as ArtifactData }
  }

  if (eventType === "tool_output" && "data" in event) {
    return applyToolOutputEvent(currentParts, event as any, state)
  }

  if (eventType === "messages" && "data" in event) {
    const data = (event as { data: unknown }).data
    if (!Array.isArray(data) || data.length === 0) return null
    return applyMessagesEvent(currentParts, data[0], state)
  }

  if (eventType === "updates") return null

  return null
}

function applyToolOutputEvent(
  currentParts: AnyPart[],
  event: { data: { tool_name: string; chunk: string; chunk_seq: number; stream: string } },
  state: PartsBuilderState
): SSEPartsResult {
  const { tool_name, chunk } = event.data
  let toolCallId = findToolCallIdByToolName(state, tool_name)

  if (!toolCallId) {
    const parts = cloneParts(currentParts)
    return { parts }
  }

  const existing = state.toolStreamingOutputs.get(toolCallId) ?? ""
  const accumulated = existing ? existing + "\n" + chunk : chunk
  state.toolStreamingOutputs.set(toolCallId, accumulated)

  const parts = cloneParts(currentParts)
  const partIndex = state.toolPartIndicesByCallId.get(toolCallId)
  if (partIndex !== undefined && isToolPart(parts[partIndex])) {
    const toolPart = parts[partIndex] as Record<string, unknown>
    const existingOutput = (toolPart.output as Record<string, unknown>) ?? {}
    toolPart.output = { ...existingOutput, streamingOutput: accumulated }
  }

  return { parts }
}

function applyMessagesEvent(
  currentParts: AnyPart[],
  rawChunk: unknown,
  state: PartsBuilderState
): SSEPartsResult | null {
  if (isAIMessageChunk(rawChunk)) {
    return applyAIMessageChunk(currentParts, rawChunk, state)
  }
  if (isToolMessage(rawChunk)) {
    return applyToolMessage(currentParts, rawChunk, state)
  }
  return null
}

function applyAIMessageChunk(
  currentParts: AnyPart[],
  chunk: AIMessageChunk,
  state: PartsBuilderState
): SSEPartsResult {
  const parts = cloneParts(currentParts)
  const kwargs = chunk.kwargs
  const content = kwargs?.content
  const messageChunkId = kwargs?.id ?? ""

  if (content && content.length > 0) {
    if (state.currentTextPartIndex === null) {
      parts.push({ type: "text", text: content, state: "streaming" })
      state.currentTextPartIndex = parts.length - 1
    } else if (state.currentTextPartIndex < parts.length) {
      const textPart = parts[state.currentTextPartIndex]
      if (textPart.type === "text") {
        textPart.text += content
      }
    } else {
      state.currentTextPartIndex = null
      parts.push({ type: "text", text: content, state: "streaming" })
      state.currentTextPartIndex = parts.length - 1
    }
  }

  const toolCalls = Array.isArray(kwargs?.tool_calls) ? kwargs.tool_calls : []
  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i]
    const tcId = getStringValue(tc.id)
    const tcName = getStringValue(tc.name)
    if (!tcId && !tcName) continue

    const resolvedId = resolveToolCallId(state, messageChunkId, i, tcId, tcName)
    if (!resolvedId) continue

    if (tcId) state.toolNamesByCallId.set(resolvedId, tcName ?? resolvedId)

    if (!state.toolPartIndicesByCallId.has(resolvedId)) {
      const toolName = tcName ?? state.toolNamesByCallId.get(resolvedId) ?? "unknown"
      parts.push({
        type: `tool-${toolName}`,
        toolCallId: resolvedId,
        state: "input-streaming",
      } as AnyPart)
      state.toolPartIndicesByCallId.set(resolvedId, parts.length - 1)
      state.toolInputAccumulators.set(resolvedId, "")
      state.currentTextPartIndex = null
    }
  }

  const toolCallChunks = Array.isArray(kwargs?.tool_call_chunks)
    ? kwargs.tool_call_chunks
    : []
  const invalidToolCalls = Array.isArray(kwargs?.invalid_tool_calls)
    ? kwargs.invalid_tool_calls
    : []

  const deltas = toolCallChunks.filter(
    (tcc) => typeof tcc.args === "string"
  )
  const fallbackDeltas =
    deltas.length > 0
      ? []
      : invalidToolCalls.filter(
        (itc) => typeof itc.args === "string"
      )

  const allDeltas = [...deltas, ...fallbackDeltas]
  for (let i = 0; i < allDeltas.length; i++) {
    const tcc = allDeltas[i]
    const indexValue = typeof tcc.index === "number" ? tcc.index : i
    const tcId = getStringValue(tcc.id)
    const tcName = getStringValue(tcc.name)
    const argsDelta = typeof tcc.args === "string" ? tcc.args : ""
    if (!argsDelta) continue

    const resolvedId = resolveToolCallId(
      state,
      messageChunkId,
      indexValue,
      tcId,
      tcName
    )
    if (!resolvedId) continue

    if (tcName) state.toolNamesByCallId.set(resolvedId, tcName)

    if (!state.toolPartIndicesByCallId.has(resolvedId)) {
      const toolName = tcName ?? state.toolNamesByCallId.get(resolvedId) ?? "unknown"
      parts.push({
        type: `tool-${toolName}`,
        toolCallId: resolvedId,
        state: "input-streaming",
      } as AnyPart)
      state.toolPartIndicesByCallId.set(resolvedId, parts.length - 1)
      state.toolInputAccumulators.set(resolvedId, "")
      state.currentTextPartIndex = null
    }

    const existingInput = state.toolInputAccumulators.get(resolvedId) ?? ""
    const newInput = existingInput + argsDelta
    state.toolInputAccumulators.set(resolvedId, newInput)

    const partIndex = state.toolPartIndicesByCallId.get(resolvedId)
    if (partIndex !== undefined && isToolPart(parts[partIndex])) {
      const toolPart = parts[partIndex] as Record<string, unknown>

      const toolName = tcName ?? state.toolNamesByCallId.get(resolvedId)
      if (toolName && toolPart.type !== `tool-${toolName}`) {
        toolPart.type = `tool-${toolName}`
      }

      const parsed = tryParseJSON(newInput)
      if (parsed !== null && !state.toolInputParsed.has(resolvedId)) {
        state.toolInputParsed.set(resolvedId, parsed)
        toolPart.state = "input-available"
        toolPart.input = parsed
      }
    }
  }

  return { parts }
}

function applyToolMessage(
  currentParts: AnyPart[],
  chunk: ToolMessage,
  state: PartsBuilderState
): SSEPartsResult {
  const parts = cloneParts(currentParts)
  const kwargs = chunk.kwargs
  const toolCallId = getStringValue(kwargs?.tool_call_id)
  const toolName = getStringValue(kwargs?.name)
  const outputText = typeof kwargs?.content === "string" ? kwargs.content : ""
  const status = getStringValue(kwargs?.status)

  if (!toolCallId) {
    return { parts }
  }

  const partIndex = state.toolPartIndicesByCallId.get(toolCallId)
  if (partIndex === undefined || !isToolPart(parts[partIndex])) {
    const name = toolName ?? "unknown"
    const isErr = status && status !== "success"
    parts.push({
      type: `tool-${name}`,
      toolCallId,
      state: isErr ? "output-error" : "output-available",
      input: state.toolInputParsed.get(toolCallId) ?? undefined,
      output: isErr
        ? undefined
        : { text: outputText, status, toolName: name },
      errorText: isErr ? outputText : undefined,
    } as AnyPart)
    state.toolPartIndicesByCallId.set(toolCallId, parts.length - 1)
    state.toolStreamingOutputs.delete(toolCallId)
    return { parts }
  }

  const toolPart = parts[partIndex] as Record<string, unknown>
  const parsedInput = state.toolInputParsed.get(toolCallId)

  if (parsedInput !== undefined) {
    toolPart.input = parsedInput
  }

  if (toolName) {
    toolPart.type = `tool-${toolName}`
    state.toolNamesByCallId.set(toolCallId, toolName)
  }

  if (status && status !== "success") {
    toolPart.state = "output-error"
    toolPart.errorText = outputText || `${toolName ?? "工具"} 执行失败`
  } else {
    toolPart.state = "output-available"
    toolPart.output = {
      text: outputText,
      status,
      toolName: toolName ?? state.toolNamesByCallId.get(toolCallId) ?? null,
      input: parsedInput,
      inputText: state.toolInputAccumulators.get(toolCallId) ?? "",
    }
  }

  state.toolStreamingOutputs.delete(toolCallId)

  return { parts }
}

export function finalizeStreamingParts(messages: UIMessage[]): UIMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "assistant") return msg
    let changed = false
    const newParts = msg.parts.map((part) => {
      if (part.type === "text" && "state" in part && part.state === "streaming") {
        changed = true
        return { ...part, state: "done" as const }
      }
      return part
    })
    return changed ? { ...msg, parts: newParts } : msg
  })
}
