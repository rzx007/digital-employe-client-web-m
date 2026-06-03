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

function isNonEmptyMessageParts(value: unknown): value is UIMessage["parts"] {
  return Array.isArray(value) && value.length > 0
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

/**
 * interrupt SSE：用后端落库的 message_parts **整体替换** 目标 assistant 的 parts，
 * 避免与流式累积的 text/tool 叠加（双卡、双行思考文案）。
 */
export function patchAssistantWithInterruptParts(
  prev: UIMessage[],
  payload: {
    message_id?: string | number | null
    message_parts?: unknown[]
  }
): UIMessage[] {
  if (prev.length === 0 || !payload.message_parts) return prev

  const dbMessageId = parseDbMessageId(payload.message_id)
  const storedParts = payload.message_parts
  const index = resolveInterruptTargetIndex(
    prev,
    dbMessageId,
    storedParts
  )
  if (index < 0) return prev

  const target = prev[index]
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
  if (isNonEmptyMessageParts(storedParts)) {
    next[index] = {
      ...target,
      ...(dbMessageId != null ? { id: dbMessageId } : {}),
      parts: storedParts,
      metadata: nextMeta,
    } as UIMessage
    return next
  }

  if (dbMessageId == null) return prev

  next[index] = {
    ...target,
    id: dbMessageId,
    metadata: nextMeta,
  } as UIMessage
  return next
}
