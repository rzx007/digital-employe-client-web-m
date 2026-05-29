import { useEffect } from "react"

import { ensureCuratorConversationAndSelect } from "@/lib/chat/curator-conversation-actions"
import { conversationExistsInList } from "@/lib/chat/conversation-selection/pick"
import type { ChatViewContact } from "@/components/chat/shared/chat-view-shared"
import type { Conversation } from "@/types/chat"
import { useQueryClient } from "@tanstack/react-query"

import { useChatStore } from "@/stores/chat-store"

/**
 * 总管联系人下会话列表为空且当前选中无效时，走 ensure 恢复默认会话。
 * 与删最后一条后的 focusAfterDeletedConversation 共用 ensureCuratorConversationAndSelect。
 */
export function useBootstrapCuratorDefaultConversation(
  contact: ChatViewContact | undefined,
  conversations: Conversation[],
  conversationsQuerySuccess: boolean
) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (contact?.type !== "curator" || !contact.curator?.id) return
    if (!conversationsQuerySuccess) return
    if (conversations.length > 0) return

    const { selectedConversationId } = useChatStore.getState()
    if (conversationExistsInList(conversations, selectedConversationId)) {
      return
    }

    void ensureCuratorConversationAndSelect(queryClient, contact)
  }, [contact, conversations, conversationsQuerySuccess, queryClient])
}
