import type { QueryClient } from "@tanstack/react-query"

import { chatKeys } from "@/lib/query-keys/chat"
import { useChatStore } from "@/stores/chat-store"
import type { Conversation } from "@/types/chat"

import { enterDraftConversation, selectConversationById } from "./apply"
import { pickFirstConversation } from "./pick"

/**
 * 删除当前选中会话后的焦点策略。
 *
 * - 同联系人仍有其它会话 → 选列表第一条并退出草稿（ConversationChatView）
 * - 无剩余会话 → 进入空草稿
 * - 若删除时处于草稿（isDraftConversation）：删光后仍留 DraftChatView，
 *   必须 bump draftSessionKey；由 DraftChatView 监听 key 清空 useChat messages
 */
export function focusAfterDeletedConversation(
  queryClient: QueryClient,
  contactId: string,
  deletedConversationId: string | number
) {
  const deletedId = String(deletedConversationId)
  const { selectedConversationId, isDraftConversation } = useChatStore.getState()

  const remaining =
    queryClient
      .getQueryData<Conversation[]>(chatKeys.conversations(contactId))
      ?.filter((c) => String(c.id) !== deletedId) ?? []

  // reconcile 可能在 onMutate 后、onSuccess 前抢先 setSelectedConversationId(null)，
  // 不能只比 selected === deletedId，否则草稿删唯一会话会提前 return、消息不清空
  const targetsCurrentSelection =
    String(selectedConversationId) === deletedId ||
    (selectedConversationId == null && remaining.length === 0)

  if (!targetsCurrentSelection) {
    return
  }

  // 避免 hydrate / ConversationChatView 继续读到已删会话的缓存
  queryClient.removeQueries({ queryKey: chatKeys.messages(deletedId) })
  queryClient.removeQueries({ queryKey: chatKeys.resources(deletedId) })

  const next = pickFirstConversation(remaining)
  if (next) {
    selectConversationById(next.id)
    return
  }

  // 草稿内发消息后 selectedConversationId 已有值，enterDraftConversation 的
  // 「空草稿短路」不会执行；此处必须 setDraftConversation(true) 以递增 draftSessionKey
  if (isDraftConversation) {
    useChatStore.getState().setDraftConversation(true)
    return
  }

  enterDraftConversation()
}
