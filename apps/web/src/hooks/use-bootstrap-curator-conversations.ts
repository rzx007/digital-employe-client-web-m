import { useEffect, useRef } from "react"

import { fetchCuratorConversation } from "@/api/chat"
import { selectConversationById } from "@/lib/chat/conversation-selection"
import { chatKeys } from "@/lib/query-keys/chat"
import type { ChatViewContact } from "@/components/chat/shared/chat-view-shared"
import type { Conversation } from "@/types/chat"
import { useQueryClient } from "@tanstack/react-query"

import { useChatStore } from "@/stores/chat-store"

/**
 * 总管联系人下会话列表为空时，调用 ensure API 创建默认会话并刷新列表。
 * 用户处于「新建对话」草稿时不自动 ensure，避免顶掉 DraftChatView。
 */
export function useBootstrapCuratorDefaultConversation(
  contact: ChatViewContact | undefined,
  conversations: Conversation[],
  conversationsQuerySuccess: boolean
) {
  const queryClient = useQueryClient()
  const isDraftConversation = useChatStore((s) => s.isDraftConversation)
  const bootstrappedRef = useRef(false)
  const curatorContactId =
    contact?.type === "curator" ? contact.curator?.id : null

  useEffect(() => {
    bootstrappedRef.current = false
  }, [curatorContactId])

  useEffect(() => {
    if (contact?.type !== "curator" || !contact.curator?.id) return
    if (isDraftConversation) return
    if (!conversationsQuerySuccess) return
    if (conversations.length > 0) return
    if (bootstrappedRef.current) return

    bootstrappedRef.current = true
    let cancelled = false

    void (async () => {
      try {
        const res = await fetchCuratorConversation()
        if (cancelled) return
        if (useChatStore.getState().isDraftConversation) return
        const id = res?.data?.id
        if (id == null) return

        await queryClient.invalidateQueries({
          queryKey: chatKeys.conversations(contact.curator!.id),
        })
        if (cancelled || useChatStore.getState().isDraftConversation) return
        selectConversationById(String(id))
      } catch {
        bootstrappedRef.current = false
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    contact,
    conversations.length,
    conversationsQuerySuccess,
    isDraftConversation,
    queryClient,
  ])
}
