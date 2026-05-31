import { touchRecentContactById } from "@/lib/chat/touch-recent-contact"
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

/** 工作台右侧总管面板选中会话（不影响聊天 Tab 当前联系人/会话） */
export function selectWorkbenchCuratorConversation(
  conversationId: string | number
) {
  useChatStore.getState().setWorkbenchCuratorConversationId(conversationId)
}

/** 选中联系人的指定会话，并更新最近消息 */
export function selectConversationForContact(
  contactId: string,
  conversationId: string | number,
  options?: { touch?: boolean }
) {
  useChatStore
    .getState()
    .selectConversation(String(contactId), String(conversationId))
  if (options?.touch !== false) {
    void touchRecentContactById(contactId)
  }
}

export function switchToContact(
  contactId: string,
  options?: { touch?: boolean }
) {
  useChatStore.getState().switchToContact(contactId)
  if (options?.touch !== false) {
    void touchRecentContactById(contactId)
  }
}

/** 选中联系人并进入聊天（与 switchToContact 等价，便于替换 setSelectedContactId） */
export function selectContactById(contactId: string) {
  switchToContact(contactId)
}

export function clearSelectedContact() {
  useChatStore.getState().setSelectedContactId(null)
}
