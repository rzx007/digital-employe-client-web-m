import type { UIMessage } from "ai"

function parseMessageId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value)
  }
  if (typeof value === "string" && value.length > 0) return value
  return null
}

function partMergeKey(part: UIMessage["parts"][number]): string {
  const toolCallId =
    "toolCallId" in part && typeof part.toolCallId === "string"
      ? part.toolCallId
      : ""
  return toolCallId ? `${part.type}:${toolCallId}` : part.type
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

  const messageId = parseMessageId(payload.message_id)
  const targetIndex =
    messageId != null
      ? prev.findIndex(
          (m) => m.role === "assistant" && String(m.id) === messageId
        )
      : -1
  const index =
    targetIndex >= 0
      ? targetIndex
      : prev.findLastIndex((m) => m.role === "assistant")
  if (index < 0) return prev

  const target = prev[index]
  const storedParts = payload.message_parts as UIMessage["parts"]
  const existingKeys = new Set(target.parts.map(partMergeKey))
  const newParts = storedParts.filter(
    (p) => !existingKeys.has(partMergeKey(p))
  )
  if (newParts.length === 0) return prev

  const next = [...prev]
  next[index] = {
    ...target,
    parts: [...target.parts, ...newParts],
  }
  return next
}
