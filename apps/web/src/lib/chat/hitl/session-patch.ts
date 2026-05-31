import type { UIMessage } from "ai"

import {
  findHitlToolCallIdInParts,
  HITL_APPROVE_MESSAGE_ID_META_KEY,
  parseDbMessageId,
  assistantMessageHasToolCallId,
} from "./message-id"

function findLastAssistantIndex(messages: UIMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") return i
  }
  return -1
}

function partMergeKey(part: UIMessage["parts"][number]): string {
  const toolCallId =
    "toolCallId" in part && typeof part.toolCallId === "string"
      ? part.toolCallId
      : ""
  return toolCallId ? `${part.type}:${toolCallId}` : part.type
}

function resolveInterruptTargetIndex(
  prev: UIMessage[],
  dbMessageId: string | null,
  messageParts: unknown[]
): number {
  if (dbMessageId != null) {
    const byId = prev.findIndex(
      (m) => m.role === "assistant" && String(m.id) === dbMessageId
    )
    if (byId >= 0) return byId
  }

  const toolCallId = findHitlToolCallIdInParts(messageParts)
  if (toolCallId) {
    for (let i = prev.length - 1; i >= 0; i--) {
      if (assistantMessageHasToolCallId(prev[i], toolCallId)) return i
    }
  }

  return findLastAssistantIndex(prev)
}

/** interrupt SSE 将后端 message_parts 合并进 composer 目标 assistant 行 */
export function patchAssistantWithInterruptParts(
  prev: UIMessage[],
  payload: {
    message_id?: string | number | null
    message_parts?: unknown[]
  }
): UIMessage[] {
  if (prev.length === 0 || !payload.message_parts) return prev

  const dbMessageId = parseDbMessageId(payload.message_id)
  const index = resolveInterruptTargetIndex(
    prev,
    dbMessageId,
    payload.message_parts
  )
  if (index < 0) return prev

  const target = prev[index]
  const storedParts = payload.message_parts as UIMessage["parts"]
  const existingKeys = new Set(target.parts.map(partMergeKey))
  const newParts = storedParts.filter(
    (p) => !existingKeys.has(partMergeKey(p))
  )
  if (newParts.length === 0 && dbMessageId == null) return prev

  const baseMeta =
    (target as UIMessage & { metadata?: Record<string, unknown> }).metadata ??
    {}
  const nextMeta: Record<string, unknown> = {
    ...baseMeta,
    streamState: "interrupted",
  }
  if (dbMessageId != null) {
    nextMeta[HITL_APPROVE_MESSAGE_ID_META_KEY] = dbMessageId
  }

  const next = [...prev]
  next[index] = {
    ...target,
    ...(dbMessageId != null ? { id: dbMessageId } : {}),
    parts:
      newParts.length > 0 ? [...target.parts, ...newParts] : target.parts,
    metadata: nextMeta,
  } as UIMessage
  return next
}
