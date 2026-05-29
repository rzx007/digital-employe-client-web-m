import type { RecentConversationItem } from "@/components/chat/conversations/recent-conversations/types"
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

/** 与 GET recent-contacts 返回顺序一致（总管已在最前） */
export function pickNextRecentContactId(
  items: RecentConversationItem[]
): string | undefined {
  return items[0]?.contactId
}
