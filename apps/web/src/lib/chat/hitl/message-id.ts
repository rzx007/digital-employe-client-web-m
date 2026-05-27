import type { UIMessage } from "ai"

/** DB `conversation_messages.id`，用于 POST /approve */
export const HITL_APPROVE_MESSAGE_ID_META_KEY = "approveMessageId"

export function parseDbMessageId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value))
  }
  if (typeof value === "string" && value.length > 0) {
    const trimmed = value.trim()
    if (/^\d+$/.test(trimmed)) return trimmed
  }
  return null
}

export function isValidApproveMessageId(value: unknown): value is string {
  const id = parseDbMessageId(value)
  return id != null && Number.isFinite(Number(id))
}

export function getApproveMessageIdFromMeta(
  meta: Record<string, unknown> | undefined
): string | null {
  if (!meta || typeof meta !== "object") return null
  return parseDbMessageId(meta[HITL_APPROVE_MESSAGE_ID_META_KEY])
}

/** 仅当 metadata 或 id 本身为 DB 数字 id 时返回；不回退客户端 id */
export function getDbMessageIdFromAssistantMessage(message: {
  id: string
  metadata?: Record<string, unknown>
}): string | null {
  return (
    getApproveMessageIdFromMeta(message.metadata) ?? parseDbMessageId(message.id)
  )
}

type StoredPart = {
  toolCallId?: string
  state?: string
}

export function findHitlToolCallIdInParts(messageParts: unknown): string | null {
  if (!Array.isArray(messageParts)) return null
  for (const raw of messageParts) {
    if (!raw || typeof raw !== "object") continue
    const part = raw as StoredPart
    if (part.state !== "input-available") continue
    if (typeof part.toolCallId === "string" && part.toolCallId.length > 0) {
      return part.toolCallId
    }
  }
  return null
}

export function assistantMessageHasToolCallId(
  message: Pick<UIMessage, "role" | "parts">,
  toolCallId: string
): boolean {
  if (message.role !== "assistant") return false
  return message.parts.some(
    (p) =>
      "toolCallId" in p &&
      typeof p.toolCallId === "string" &&
      p.toolCallId === toolCallId
  )
}
