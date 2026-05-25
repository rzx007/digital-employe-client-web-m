import type { UIMessage } from "ai"

/** POST /approve 使用的 message_id（与 session.hitlMessageId 对齐） */
export function resolveHitlApproveMessageId(
  message: UIMessage,
  sessionHitlMessageId: string | null | undefined
): string {
  if (!sessionHitlMessageId) return message.id

  const sessionId = String(sessionHitlMessageId)
  if (String(message.id) === sessionId) return sessionId

  const meta = (message as UIMessage & { metadata?: Record<string, unknown> })
    .metadata
  if (
    meta &&
    typeof meta === "object" &&
    typeof meta.hitlAnchorMessageId === "string" &&
    meta.hitlAnchorMessageId === sessionId
  ) {
    return sessionId
  }
  const mergedIds = meta?.mergedAssistantIds
  if (
    Array.isArray(mergedIds) &&
    mergedIds.some((id) => String(id) === sessionId)
  ) {
    return sessionId
  }
  return message.id
}
