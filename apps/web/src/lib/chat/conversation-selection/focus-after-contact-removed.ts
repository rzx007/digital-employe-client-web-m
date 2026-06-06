import type { RecentConversationItem } from "@/components/chat/conversations/recent-conversations/types"
import { contactIdsMatch } from "@/lib/chat/contact-utils"
import type { Contact } from "@/types/chat"

import {
  clearSelectedContact,
  switchToContact,
} from "./apply"
import { resolveRecentContactSelectionId, recentItemTypeHint } from "./resolve-recent-selection-id"

/** 左侧最近对话：删除当前联系人的全部会话后切换焦点 */
export function focusAfterContactRemoved(
  currentContactId: string | null,
  removedContactId: string,
  remainingRecentItems: RecentConversationItem[],
  contacts: readonly Contact[],
  removedItem?: Pick<RecentConversationItem, "isCurator" | "isGroup">
) {
  const removedHint = removedItem ? recentItemTypeHint(removedItem) : undefined
  if (!contactIdsMatch(currentContactId, removedContactId, contacts, removedHint)) {
    return
  }

  const nextItem = remainingRecentItems[0]
  if (nextItem) {
    switchToContact(resolveRecentContactSelectionId(nextItem, contacts))
    return
  }

  clearSelectedContact()
}
