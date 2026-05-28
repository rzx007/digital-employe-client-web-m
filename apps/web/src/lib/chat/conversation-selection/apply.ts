import { useChatStore } from "@/stores/chat-store"

/** 进入草稿（新建会话）；已在空草稿时不重复递增 draftSessionKey */
export function enterDraftConversation() {
  const state = useChatStore.getState()
  if (state.isDraftConversation && state.selectedConversationId == null) {
    return
  }
  state.setDraftConversation(true)
}

/** 选中一条已有会话并退出草稿 */
export function selectConversationById(conversationId: string | number) {
  const state = useChatStore.getState()
  state.setSelectedConversationId(conversationId)
  state.setDraftConversation(false)
}

export function switchToContact(contactId: string) {
  useChatStore.getState().switchToContact(contactId)
}

export function clearSelectedContact() {
  useChatStore.getState().setSelectedContactId(null)
}
