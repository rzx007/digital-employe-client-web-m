import type { QueryClient } from "@tanstack/react-query"

import { fetchContacts, fetchConversationsByContactId } from "@/api/chat"
import { getContactId } from "@/lib/chat/contact-utils"
import { ensureCuratorConversationAndSelect } from "@/lib/chat/curator-conversation-actions"
import { selectConversationForContact } from "@/lib/chat/conversation-selection"
import { pickFirstConversation } from "@/lib/chat/conversation-selection/pick"
import { conversationListQueryKey } from "@/lib/chat/conversation-list-query-key"
import { resetChatRightPanels } from "@/lib/chat/reset-chat-right-panels"
import { chatKeys } from "@/lib/query-keys/chat"
import { useChatStore } from "@/stores/chat-store"

/**
 * 切换工作空间后：清跨项目缓存 → 选总管 → 选已有会话或 ensure 默认会话。
 */
export async function restoreChatAfterWorkspaceSwitch(
  queryClient: QueryClient,
  workspaceId: number
): Promise<void> {
  resetChatRightPanels()
  useChatStore.getState().clearCuratorNavigationReturn()
  useChatStore.getState().setWorkbenchCuratorConversationId(null)

  queryClient.removeQueries({ queryKey: chatKeys.allConversations() })
  void queryClient.invalidateQueries()

  const contacts = await queryClient.fetchQuery({
    queryKey: chatKeys.contacts(),
    queryFn: ({ signal }) => fetchContacts(signal),
  })

  useChatStore.getState().setContacts(contacts)

  const curator = contacts.find((c) => c.type === "curator")
  if (!curator?.curator) {
    useChatStore.getState().setSelectedContactId(null)
    return
  }

  const contactId = getContactId(curator) ?? String(curator.curator.id)
  useChatStore.getState().setSelectedContactId(contactId)
  useChatStore.getState().setActiveTab("chat")

  let conversations = await fetchConversationsByContactId(contactId, curator)
  if (conversations.length === 0) {
    try {
      const ensured = await ensureCuratorConversationAndSelect(
        queryClient,
        curator
      )
      conversations = [ensured]
    } catch {
      return
    }
  } else {
    queryClient.setQueryData(
      conversationListQueryKey(contactId, workspaceId),
      conversations
    )
    const first = pickFirstConversation(conversations)
    if (first) {
      selectConversationForContact(contactId, first.id)
    }
  }
}
