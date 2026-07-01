import { useEffect, useRef } from "react"
import { useShallow } from "zustand/react/shallow"

import { useConversationsQuery } from "@/hooks/use-chat-queries"
import { useChatStore } from "@/stores/chat-store"

import type { ChatViewContact } from "@/components/chat/chat-view-shared"

import { enterDraftConversation, selectConversationById } from "./apply"
import { isPreservedEmployeeConversationSelection } from "./employee-deep-link"
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

      const wbId = useChatStore.getState().workbenchCuratorConversationId
      if (
        wbId != null &&
        String(wbId) !== String(selectedConversationId) &&
        conversationExistsInList(conversations, wbId)
      ) {
        selectConversationById(wbId)
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
      // 群/总管深链执行会话不在 1:1 列表里，列表空是正常态
      if (
        selectedConversationId != null &&
        isPreservedEmployeeConversationSelection(
          selectedContactId,
          selectedConversationId,
          conversations
        )
      ) {
        return
      }
      // 列表已空但选中 id 仍指向已删会话（如最近会话删除后 focus 未触发）
      enterDraftConversation()
      return
    }

    if (isDraftConversation) {
      return
    }

    if (conversationExistsInList(conversations, selectedConversationId)) {
      return
    }

    // 深链 preserved 选中：勿抢选旧会话；员工单聊已退场，不再 auto-pick 第一条
    if (
      isPreservedEmployeeConversationSelection(
        selectedContactId,
        selectedConversationId,
        conversations
      )
    ) {
      return
    }
  }, [
    conversations,
    conversationsQuerySuccess,
    contact,
    isCurator,
    isDraftConversation,
    selectedContactId,
    selectedConversationId,
  ])
}
