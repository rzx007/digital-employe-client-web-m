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

/** 工作台总管面板选中会话；总管「当前会话」与聊天 Tab 共享，故聊天 Tab 也同步定位到总管+该会话 */
export function selectWorkbenchCuratorConversation(
  conversationId: string | number
) {
  useChatStore.getState().setWorkbenchCuratorConversationId(conversationId)
}

/** 选中联系人的指定会话 */
export function selectConversationForContact(
  contactId: string,
  conversationId: string | number
) {
  useChatStore
    .getState()
    .selectConversation(String(contactId), String(conversationId))
}

/** 联系人页：仅选中查看详情，不切换 Tab、不影响对话 Tab 选中态 */
export function selectContactForDetail(contactId: string) {
  useChatStore.getState().setDetailContactId(contactId)
}

export function switchToContact(contactId: string) {
  useChatStore.getState().switchToContact(contactId)
}

/** 选中联系人并进入聊天（与 switchToContact 等价，便于替换 setSelectedContactId） */
export function selectContactById(contactId: string) {
  switchToContact(contactId)
}

/** 进入对话 Tab（含非深链时归位总管的 store 安全网） */
export function enterChatTab() {
  useChatStore.getState().setActiveTab("chat")
}

export function clearSelectedContact() {
  useChatStore.getState().setSelectedContactId(null)
}

export function clearDetailContact() {
  useChatStore.getState().setDetailContactId(null)
}
