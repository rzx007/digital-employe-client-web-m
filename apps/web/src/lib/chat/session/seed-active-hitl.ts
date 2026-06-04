import type { Message } from "@/types/chat"
import {
  parseDbMessageId,
  seedActiveHitlFromMessageParts,
  type ActiveHitl,
} from "@/lib/chat/hitl"

export function seedActiveHitlFromStoredMessages(
  storedMessages: Message[]
): ActiveHitl | null {
  for (let i = storedMessages.length - 1; i >= 0; i--) {
    const row = storedMessages[i]
    if (row.role !== "assistant" || row.streamState !== "interrupted") continue
    if (typeof row.metadata?.approved_at === "string" && row.metadata.approved_at.length > 0) continue
    const dbId = parseDbMessageId(row.id)
    if (!dbId || !row.messageParts?.length) continue
    const seeded = seedActiveHitlFromMessageParts(dbId, row.messageParts)
    if (seeded) return seeded
  }
  return null
}
