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
  const { selectedConversationId, isDraftConversation } =
    useChatStore(
      useShallow((state) => ({
        selectedConversationId: state.selectedConversationId,
        isDraftConversation: state.isDraftConversation,
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
        // 列表为空时由 ensureCuratorConversationAndSelect 负责恢复，勿清选中态
        return
      }

      if (selectedConversationId == null) {
        const next = pickFirstConversation(conversations)
        if (next) {
          selectConversationById(next.id)
        }
        return
      }

      if (conversationExistsInList(conversations, selectedConversationId)) {
        return
      }

      // 新建会话刚选中时列表 refetch 可能尚未包含该 id，勿抢选回旧会话
      return
    }

    if (!conversationsQuerySuccess) return

    if (conversations.length === 0) {
      // 草稿或删光/onMutate 进草稿中，勿抢跑
      if (isDraftConversation) {
        return
      }
      if (selectedConversationId != null) {
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
  ])
}
