import type { QueryClient } from "@tanstack/react-query"

import { fetchConversationsByContactId } from "@/api/chat"
import { findContactInList } from "@/lib/chat/contact-utils"
import { chatKeys } from "@/lib/query-keys/chat"
import { useChatStore } from "@/stores/chat-store"

/** 打开任务关联会话：先刷新该员工的会话列表，避免 auto-select 落到历史第一条。 */
export async function navigateToTaskConversation(
  queryClient: QueryClient,
  employeeId: number | string,
  conversationId: number | string
): Promise<void> {
  const contactId = String(employeeId)
  const convId = String(conversationId)
  const contact = findContactInList(useChatStore.getState().contacts, contactId)

  if (contact) {
    await queryClient.fetchQuery({
      queryKey: chatKeys.conversations(contactId),
      queryFn: ({ signal }) =>
        fetchConversationsByContactId(contactId, contact, { signal }),
    })
  } else {
    await queryClient.invalidateQueries({
      queryKey: chatKeys.conversations(contactId),
    })
  }

  const { selectConversation, setActiveTab } = useChatStore.getState()
  selectConversation(contactId, convId)
  setActiveTab("chat")
}
