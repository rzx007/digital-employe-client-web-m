import type { QueryClient } from "@tanstack/react-query"

import { chatKeys } from "@/lib/query-keys/chat"
import { useChatStore } from "@/stores/chat-store"
import type { Conversation } from "@/types/chat"

/**
 * 删除当前选中会话后的焦点策略（与 useConversationAutoSelect 对齐）：
 * - 同联系人仍有会话 → 选中列表第一条并退出草稿
 * - 否则 → 进入草稿欢迎态
 */
export function focusAfterDeletedConversation(
  queryClient: QueryClient,
  contactId: string,
  deletedConversationId: string | number
) {
  const {
    selectedConversationId,
    setSelectedConversationId,
    setDraftConversation,
  } = useChatStore.getState()

  if (String(selectedConversationId) !== String(deletedConversationId)) {
    return
  }

  const remaining =
    queryClient.getQueryData<Conversation[]>(
      chatKeys.conversations(contactId)
    ) ?? []

  if (remaining.length > 0) {
    setSelectedConversationId(remaining[0]!.id)
    setDraftConversation(false)
    return
  }

  setSelectedConversationId(null)
  setDraftConversation(true)
}
