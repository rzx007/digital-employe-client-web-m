import type { UIMessageChunk } from "ai"

import type { LangChainStreamParseState } from "../langchain-stream-parser"
import { HITL_TOOL_NAMES } from "./constants"

type StoredMessagePart = {
  type?: string
  toolCallId?: string
  state?: string
  input?: unknown
}

/** 流式阶段已下发 input-available 的 HITL toolCallId（interrupt 时勿重复注入） */
export function collectHitlToolCallIdsAlreadyStreamed(
  state: LangChainStreamParseState
): Set<string> {
  const ids = new Set<string>()
  for (const pending of state.pendingToolCalls.values()) {
    if (!pending.sentInputAvailable || !pending.toolCallId || !pending.toolName) {
      continue
    }
    if (!HITL_TOOL_NAMES.has(pending.toolName)) continue
    ids.add(pending.toolCallId)
  }
  return ids
}

export type BuildHitlInterruptStreamChunksOptions = {
  /** 已在当前 SSE 连接中流式下发过的 HITL toolCallId */
  skipToolCallIds?: ReadonlySet<string>
}

/** 将后端 message_parts 中的 pending HITL part 转为 useChat stream chunks */
export function buildHitlInterruptStreamChunks(
  messageParts: unknown,
  options?: BuildHitlInterruptStreamChunksOptions
): UIMessageChunk[] {
  if (!Array.isArray(messageParts)) return []

  const skip = options?.skipToolCallIds
  const chunks: UIMessageChunk[] = []
  for (const raw of messageParts) {
    if (!raw || typeof raw !== "object") continue
    const part = raw as StoredMessagePart
    if (typeof part.type !== "string" || !part.type.startsWith("tool-")) {
      continue
    }
    if (part.state !== "input-available") continue
    const toolName = part.type.slice("tool-".length)
    if (!HITL_TOOL_NAMES.has(toolName)) continue
    if (!part.toolCallId) continue
    if (skip?.has(part.toolCallId)) continue

    chunks.push({
      type: "tool-input-start",
      toolCallId: part.toolCallId,
      toolName,
    })
    chunks.push({
      type: "tool-input-available",
      toolCallId: part.toolCallId,
      toolName,
      input: part.input ?? {},
    })
  }
  return chunks
}
