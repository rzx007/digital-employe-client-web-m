import { selectConversationForContact } from "@/lib/chat/conversation-selection"
import { getQueryClient } from "@/lib/query-client"
import { chatKeys } from "@/lib/query-keys/chat"
import { useChatStore } from "@/stores/chat-store"

export type GroupNavigationReturn = {
  groupContactId: string
  groupConversationId: string | number
  employeeId: string
  employeeConversationId: string | number
}

export function navigateToEmployeeFromGroup(options: {
  groupContactId: string
  groupConversationId: string | number
  employeeId: number
  employeeConversationId: number
}) {
  const queryClient = getQueryClient()
  const state = useChatStore.getState()
  const employeeContactId = `employee:${options.employeeId}`
  const returnCtx: GroupNavigationReturn = {
    groupContactId: options.groupContactId,
    groupConversationId: options.groupConversationId,
    employeeId: employeeContactId,
    employeeConversationId: options.employeeConversationId,
  }
  state.setGroupNavigationReturn(returnCtx)
  state.bumpGroupDeepLinkMount()
  selectConversationForContact(
    employeeContactId,
    options.employeeConversationId
  )
  state.setActiveTab("chat")
  void queryClient.invalidateQueries({
    queryKey: chatKeys.messages(String(options.employeeConversationId)),
    refetchType: "active",
  })
  void queryClient.invalidateQueries({
    queryKey: chatKeys.conversations(employeeContactId),
  })
}

export function returnToGroupFromEmployeeNavigation(): boolean {
  const state = useChatStore.getState()
  const ctx = state.groupNavigationReturn
  if (!ctx) return false

  state.clearGroupNavigationReturn()
  selectConversationForContact(ctx.groupContactId, ctx.groupConversationId)
  state.setActiveTab("chat")
  return true
}

export function shouldShowGroupReturnBar(
  ctx: GroupNavigationReturn | null,
  selectedContactId: string | null,
  selectedConversationId: string | number | null
): boolean {
  if (!ctx) return false
  if (selectedContactId !== ctx.employeeId) return false
  return String(selectedConversationId) === String(ctx.employeeConversationId)
}

/** 群深链进入员工执行会话时用独立 key，避免 useChat 同 id 残留 streaming */
export function groupDeepLinkConversationViewKey(
  conversationId: string | number,
  ctx: GroupNavigationReturn | null,
  mountKey: number
): string {
  if (
    ctx &&
    String(conversationId) === String(ctx.employeeConversationId)
  ) {
    return `${conversationId}-group-${mountKey}`
  }
  return String(conversationId)
}

/** 从群协作点进成员执行会话：只读展示 DB 快照，不走 live SSE/resume */
export function isGroupDeepLinkExecutionView(
  ctx: GroupNavigationReturn | null,
  conversationId: string | number | null | undefined
): boolean {
  if (!ctx || conversationId == null) return false
  return String(conversationId) === String(ctx.employeeConversationId)
}
