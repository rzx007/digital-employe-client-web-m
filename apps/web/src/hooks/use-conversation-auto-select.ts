import { useEffect, useRef } from "react"
import { useShallow } from "zustand/react/shallow"

import { useConversationsQuery } from "@/hooks/use-chat-queries"
import { CURATOR_PINNED_CONVERSATION_ID } from "@/lib/constants"
import { useChatStore } from "@/stores/chat-store"

import type { ChatViewContact } from "@/components/chat/chat-view-shared"

/**
 * 自动选择对话的自定义 Hook
 * 当联系人改变或者对话列表加载完成时，自动选择合适的对话进行显示
 *
 * @param selectedContactId - 当前选中的联系人 ID
 * @param contact - 联系人对象，可选参数
 */
export function useConversationAutoSelect(
  selectedContactId: string | null,
  contact?: ChatViewContact
) {
  // 从聊天状态管理 store 中获取所需的状态和方法
  const {
    selectedConversationId,
    isDraftConversation,
    setDraftConversation,
    setSelectedConversationId,
  } = useChatStore(
    useShallow((state) => ({
      selectedConversationId: state.selectedConversationId,
      isDraftConversation: state.isDraftConversation,
      setDraftConversation: state.setDraftConversation,
      setSelectedConversationId: state.setSelectedConversationId,
    }))
  )

  // 判断当前联系人是否为主理人类型
  const isCurator = contact?.type === "curator"

  // 获取与当前联系人的对话列表
  const { data: conversations = [], isSuccess: conversationsQuerySuccess } =
    useConversationsQuery(selectedContactId, contact)

  // 使用 ref 存储上一次的联系人 ID 和对话 ID，用于检测变化
  const prevContactIdRef = useRef(selectedContactId)
  const prevConversationIdRef = useRef(selectedConversationId)

  useEffect(() => {
    // 检测联系人或对话是否发生变化
    const contactChanged = prevContactIdRef.current !== selectedContactId
    const conversationChanged =
      prevConversationIdRef.current !== selectedConversationId

    // 如果两者都发生了变化且已有选中的对话，则更新 ref 并返回
    if (
      contactChanged &&
      conversationChanged &&
      selectedConversationId != null
    ) {
      prevContactIdRef.current = selectedContactId
      prevConversationIdRef.current = selectedConversationId
      return
    }

    // 更新 ref 的值
    prevContactIdRef.current = selectedContactId
    prevConversationIdRef.current = selectedConversationId

    // 如果没有选中的联系人，则不执行任何操作
    if (!selectedContactId) return

    // 处理主理人类型的逻辑
    if (isCurator) {
      // 如果当前为草稿对话，则不执行任何操作
      if (isDraftConversation) {
        return
      }

      // 如果当前选中的不是主理人固定对话
      if (selectedConversationId !== CURATOR_PINNED_CONVERSATION_ID) {
        // 如果没有对话，则设置为主理人固定对话并标记非草稿
        if (conversations.length === 0) {
          setSelectedConversationId(CURATOR_PINNED_CONVERSATION_ID)
          setDraftConversation(false)
          return
        }

        // 检查选中的对话是否存在于当前对话列表中
        const hasSelected = conversations.some(
          (conversation) => conversation.id === selectedConversationId
        )

        // 如果不存在，则切换到主理人固定对话并标记非草稿
        if (!hasSelected) {
          setSelectedConversationId(CURATOR_PINNED_CONVERSATION_ID)
          setDraftConversation(false)
        }
      }
      return
    }

    // 如果对话查询未成功完成，则等待
    if (!conversationsQuerySuccess) return

    // 如果没有对话存在
    if (conversations.length === 0) {
      // 如果当前有选中的对话，则取消选中
      if (selectedConversationId != null) {
        setSelectedConversationId(null)
        return
      }

      // 如果当前不是草稿对话，则设置为草稿对话
      if (!isDraftConversation) {
        setDraftConversation(true)
      }
      return
    }

    // 如果当前为草稿对话，则不执行任何操作
    if (isDraftConversation) {
      return
    }

    // 检查当前选中的对话是否存在于对话列表中
    const hasSelected = conversations.some(
      (conversation) => conversation.id === selectedConversationId
    )

    // 如果不存在，则选择第一个对话
    if (!hasSelected) {
      setSelectedConversationId(conversations[0].id)
    }
  }, [
    conversations,
    conversationsQuerySuccess,
    isCurator,
    isDraftConversation,
    selectedContactId,
    selectedConversationId,
    setDraftConversation,
    setSelectedConversationId,
  ])
}
