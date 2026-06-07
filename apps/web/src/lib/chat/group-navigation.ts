import { selectConversationForContact } from "@/lib/chat/conversation-selection"
import { fetchContacts, fetchConversationsByContactId } from "@/api/chat"
import { findContactInList } from "@/lib/chat/contact-utils"
import { getQueryClient } from "@/lib/query-client"
import { chatKeys } from "@/lib/query-keys/chat"
import { useChatStore } from "@/stores/chat-store"
import type { Contact, Conversation } from "@/types/chat"
import type { QueryClient } from "@tanstack/react-query"

export type GroupNavigationReturn = {
  groupContactId: string
  groupConversationId: string | number
  employeeId: string
  employeeConversationId: string | number
}

export type NavigateToGroupChatOptions = {
  groupId: number
  groupConversationId: number
  groupName?: string
}

/** 总管拉群成功后：刷新通讯录并进入群协作会话 */
export async function navigateToGroupChat(
  queryClient: QueryClient,
  options: NavigateToGroupChatOptions
): Promise<boolean> {
  const groupContactId = `group:${options.groupId}`

  const contacts = await queryClient.fetchQuery({
    queryKey: chatKeys.contacts(),
    queryFn: ({ signal }) => fetchContacts(signal),
  })
  useChatStore.getState().setContacts(contacts)

  let contact: Contact | undefined = findContactInList(contacts, groupContactId)
  if (!contact) {
    contact = {
      type: "group",
      group: {
        id: String(options.groupId),
        name: options.groupName ?? "群协作",
        participants: [],
      },
    }
    useChatStore.getState().setContacts([...contacts, contact])
  }

  const conversations = await queryClient.fetchQuery({
    queryKey: chatKeys.conversations(groupContactId),
    queryFn: ({ signal }) =>
      fetchConversationsByContactId(groupContactId, contact, { signal }),
  })

  const conversationId = String(options.groupConversationId)
  if (!conversations.some((item) => String(item.id) === conversationId)) {
    const seeded: Conversation = {
      id: conversationId,
      title: options.groupName ?? contact.group?.name ?? "群协作",
      contactId: groupContactId,
      updatedAt: new Date(),
      unreadCount: 0,
    }
    queryClient.setQueryData(chatKeys.conversations(groupContactId), [
      ...conversations,
      seeded,
    ])
  }

  selectConversationForContact(groupContactId, conversationId)
  useChatStore.getState().setActiveTab("chat")

  void queryClient.invalidateQueries({
    queryKey: chatKeys.messages(conversationId),
    refetchType: "active",
  })
  void queryClient.invalidateQueries({
    queryKey: chatKeys.groupRoom(conversationId),
    refetchType: "active",
  })

  return true
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

/** 从群协作点进成员执行会话：独立 remount key */
export function isGroupDeepLinkExecutionView(
  ctx: GroupNavigationReturn | null,
  conversationId: string | number | null | undefined
): boolean {
  if (!ctx || conversationId == null) return false
  return String(conversationId) === String(ctx.employeeConversationId)
}
