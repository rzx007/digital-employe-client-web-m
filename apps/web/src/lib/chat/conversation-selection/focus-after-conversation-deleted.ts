import type { QueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { ensureCuratorConversationAndSelect } from "@/lib/chat/curator-conversation-actions"
import { conversationListQueryKey } from "@/lib/chat/conversation-list-query-key"
import { chatKeys } from "@/lib/query-keys/chat"
import { useChatStore } from "@/stores/chat-store"
import type { Contact, Conversation } from "@/types/chat"

import { enterDraftConversation, selectConversationById } from "./apply"
import { pickFirstConversation } from "./pick"

/**
 * 删除当前选中会话后的焦点策略。
 *
 * - 同联系人仍有其它会话 → 选列表第一条并退出草稿（ConversationChatView）
 * - 无剩余会话 → 员工/群组进入空草稿；总管走 ensure 恢复默认会话
 */
export async function focusAfterDeletedConversation(
  queryClient: QueryClient,
  contactId: string,
  deletedConversationId: string | number,
  contact?: Contact
) {
  const deletedId = String(deletedConversationId)
  const { selectedConversationId, isDraftConversation } = useChatStore.getState()

  const remaining =
    queryClient
      .getQueryData<Conversation[]>(conversationListQueryKey(contactId))
      ?.filter((c) => String(c.id) !== deletedId) ?? []

  const targetsCurrentSelection =
    String(selectedConversationId) === deletedId ||
    (selectedConversationId == null && remaining.length === 0)

  if (!targetsCurrentSelection) {
    return
  }

  queryClient.removeQueries({ queryKey: chatKeys.messages(deletedId) })
  queryClient.removeQueries({ queryKey: chatKeys.resources(deletedId) })

  const next = pickFirstConversation(remaining)
  if (next) {
    selectConversationById(next.id)
    return
  }

  if (contact?.type === "curator") {
    try {
      await ensureCuratorConversationAndSelect(queryClient, contact)
    } catch (error) {
      toast.error("恢复总管会话失败", {
        description:
          error instanceof Error ? error.message : "请稍后重试",
      })
    }
    return
  }

  if (isDraftConversation) {
    useChatStore.getState().setDraftConversation(true)
    return
  }

  enterDraftConversation()
}
