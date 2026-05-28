import type { RecentConversationItem } from "@/components/chat/conversations/recent-conversations/types"

import {
  clearSelectedContact,
  switchToContact,
} from "./apply"
import { pickNextRecentContactId } from "./pick"

/** 左侧最近对话：删除当前联系人的全部会话后切换焦点 */
export function focusAfterContactRemoved(
  currentContactId: string | null,
  removedContactId: string,
  remainingRecentItems: RecentConversationItem[]
) {
  if (currentContactId !== removedContactId) return

  const nextContactId = pickNextRecentContactId(remainingRecentItems)
  if (nextContactId) {
    switchToContact(nextContactId)
    return
  }

  clearSelectedContact()
}
