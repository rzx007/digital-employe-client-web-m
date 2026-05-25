import type { UIMessageChunk } from "ai"

import {
  CLARIFY_TOOL_NAME,
  DOCUMENT_PLAN_TOOL_NAME,
} from "./hitl-tool-call-resolve"

const HITL_TOOL_NAMES = new Set([
  CLARIFY_TOOL_NAME,
  DOCUMENT_PLAN_TOOL_NAME,
])

type StoredMessagePart = {
  type?: string
  toolCallId?: string
  state?: string
  input?: unknown
}

/** 将后端 message_parts 中的 pending HITL part 转为 useChat stream chunks */
export function buildHitlInterruptStreamChunks(
  messageParts: unknown
): UIMessageChunk[] {
  if (!Array.isArray(messageParts)) return []

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
