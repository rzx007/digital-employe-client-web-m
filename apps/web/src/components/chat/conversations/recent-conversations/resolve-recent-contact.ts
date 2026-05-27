import { findContactInList } from "@/lib/chat/contact-utils"
import type { Contact } from "@/types/chat"
import type { RecentConversationItem } from "./types"

/** 为最近会话项解析 Contact，用于拉取/删除该联系人的全部会话 */
export function resolveContactForRecentItem(
  contactId: string,
  item: Pick<RecentConversationItem, "isCurator">,
  contacts: Contact[]
): Contact | null {
  if (item.isCurator) return null
  return findContactInList(contacts, contactId) ?? null
}
