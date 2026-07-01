import type { Conversation } from "@/types/chat"

export function pickFirstConversation(
  conversations: Conversation[]
): Conversation | undefined {
  return conversations[0]
}

export function conversationExistsInList(
  conversations: Conversation[],
  conversationId: string | number | null | undefined
): boolean {
  if (conversationId == null) return false
  return conversations.some((c) => String(c.id) === String(conversationId))
}
