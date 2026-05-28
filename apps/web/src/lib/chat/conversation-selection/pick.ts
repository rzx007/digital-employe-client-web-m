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

/** 与最近对话侧栏 displayItems 排序一致 */
export function pickNextRecentContactId(
  items: RecentConversationItem[]
): string | undefined {
  if (items.length === 0) return undefined
  const sorted = [...items].sort((a, b) => {
    if (a.isCurator && !b.isCurator) return -1
    if (!a.isCurator && b.isCurator) return 1
    if (a.isPinned && !b.isPinned) return -1
    if (!a.isPinned && b.isPinned) return 1
    const ta = a.updatedAt?.getTime() ?? 0
    const tb = b.updatedAt?.getTime() ?? 0
    return tb - ta
  })
  return sorted[0]?.contactId
}
