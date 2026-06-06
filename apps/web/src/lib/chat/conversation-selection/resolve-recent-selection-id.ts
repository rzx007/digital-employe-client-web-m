import type { RecentConversationItem } from "@/components/chat/conversations/recent-conversations/types"
import { findContactInList, getContactId } from "@/lib/chat/contact-utils"
import type { Contact } from "@/types/chat"

export function recentItemTypeHint(
  item: Pick<RecentConversationItem, "isCurator" | "isGroup">
): Contact["type"] {
  return item.isCurator ? "curator" : item.isGroup ? "group" : "employee"
}

/** 最近会话项 contactId 为裸数字；选中态使用带 type 前缀的 id */
export function resolveRecentContactSelectionId(
  item: Pick<RecentConversationItem, "contactId" | "isCurator" | "isGroup">,
  contacts: readonly Contact[]
): string {
  const contact = findContactInList(
    contacts,
    item.contactId,
    recentItemTypeHint(item)
  )
  return getContactId(contact) ?? item.contactId
}
