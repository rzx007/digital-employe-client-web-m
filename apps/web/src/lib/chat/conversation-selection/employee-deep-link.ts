import { useChatStore } from "@/stores/chat-store"

import { conversationExistsInList } from "./pick"

/**
 * 从总管 / 群协作深链到员工执行会话时，该会话可能不在员工 1:1 列表里
 * （后端 _exclude_group_internal_convs 会过滤群任务会话）。
 */
export function getEmployeeDeepLinkConversationId(
  selectedContactId: string | null,
  selectedConversationId: string | number | null
): string | number | null {
  if (selectedContactId == null || selectedConversationId == null) {
    return null
  }
  const state = useChatStore.getState()
  const convKey = String(selectedConversationId)

  const group = state.groupNavigationReturn
  if (
    group &&
    group.employeeId === selectedContactId &&
    String(group.employeeConversationId) === convKey
  ) {
    return selectedConversationId
  }

  const curator = state.curatorNavigationReturn
  if (
    curator &&
    String(curator.employeeConversationId) === convKey &&
    (curator.employeeId === selectedContactId ||
      curator.employeeId === selectedContactId.replace(/^employee:/, "") ||
      `employee:${curator.employeeId}` === selectedContactId)
  ) {
    return selectedConversationId
  }

  return null
}

export function isPreservedEmployeeConversationSelection(
  selectedContactId: string | null,
  selectedConversationId: string | number | null,
  conversations: { id: string | number }[]
): boolean {
  const deepLinkId = getEmployeeDeepLinkConversationId(
    selectedContactId,
    selectedConversationId
  )
  if (deepLinkId == null) return false
  return !conversationExistsInList(conversations, deepLinkId)
}
