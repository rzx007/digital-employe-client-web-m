import { useEffect, useRef } from "react"
import { useShallow } from "zustand/react/shallow"

import { useConversationsQuery } from "@/hooks/use-chat-queries"
import { useChatStore } from "@/stores/chat-store"

import type { ChatViewContact } from "@/components/chat/chat-view-shared"

import { enterDraftConversation, selectConversationById } from "./apply"
import { conversationExistsInList, pickFirstConversation } from "./pick"

/**
 * 联系人 / 会话列表变化后校正选中态（合并原 useConversationAutoSelect 与 layout 孤儿检测）。
 */
export function useReconcileConversationSelection(
  selectedContactId: string | null,
  contact?: ChatViewContact
) {
  const { selectedConversationId, isDraftConversation, setSelectedConversationId } =
    useChatStore(
      useShallow((state) => ({
        selectedConversationId: state.selectedConversationId,
        isDraftConversation: state.isDraftConversation,
        setSelectedConversationId: state.setSelectedConversationId,
      }))
    )

  const isCurator = contact?.type === "curator"

  const {
    data: conversations = [],
    isSuccess: conversationsQuerySuccess,
  } = useConversationsQuery(selectedContactId, contact)

  const prevContactIdRef = useRef(selectedContactId)
  const prevConversationIdRef = useRef(selectedConversationId)

  useEffect(() => {
    const contactChanged = prevContactIdRef.current !== selectedContactId
    const conversationChanged =
      prevConversationIdRef.current !== selectedConversationId

    if (
      contactChanged &&
      conversationChanged &&
      selectedConversationId != null
    ) {
      prevContactIdRef.current = selectedContactId
      prevConversationIdRef.current = selectedConversationId
      return
    }

    prevContactIdRef.current = selectedContactId
    prevConversationIdRef.current = selectedConversationId

    if (!selectedContactId) return

    if (isCurator) {
      if (!conversationsQuerySuccess) return

      if (conversations.length === 0) {
        if (selectedConversationId != null) {
          setSelectedConversationId(null)
        }
        return
      }

      if (conversationExistsInList(conversations, selectedConversationId)) {
        return
      }

      const next = pickFirstConversation(conversations)
      if (next) {
        selectConversationById(next.id)
      }
      return
    }

    if (!conversationsQuerySuccess) return

    if (conversations.length === 0) {
      // 草稿模式下列表变空时，勿抢先只清 selectedConversationId（会打断
      // focusAfterDeletedConversation 的 targetsCurrentSelection 判断）
      if (isDraftConversation) {
        return
      }
      if (selectedConversationId != null) {
        setSelectedConversationId(null)
        return
      }
      enterDraftConversation()
      return
    }

    if (isDraftConversation) {
      return
    }

    if (conversationExistsInList(conversations, selectedConversationId)) {
      return
    }

    const next = pickFirstConversation(conversations)
    if (next) {
      selectConversationById(next.id)
    }
  }, [
    conversations,
    conversationsQuerySuccess,
    isCurator,
    isDraftConversation,
    selectedContactId,
    selectedConversationId,
    setSelectedConversationId,
  ])
}
