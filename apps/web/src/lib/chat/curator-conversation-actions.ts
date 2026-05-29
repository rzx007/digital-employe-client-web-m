import type { QueryClient } from "@tanstack/react-query"

import { createConversation } from "@/api/chat"
import { selectConversationById } from "@/lib/chat/conversation-selection"
import { chatKeys } from "@/lib/query-keys/chat"
import type { Contact, Conversation, Message } from "@/types/chat"

export const CURATOR_DEFAULT_CONVERSATION_TITLE = "新对话"

const PLACEHOLDER_CURATOR_TITLES = new Set([
  CURATOR_DEFAULT_CONVERSATION_TITLE,
  "总管对话",
])

/** 首条用户消息后是否应把占位标题改成消息摘要 */
export function shouldRenameCuratorConversationOnFirstMessage(
  title: string | undefined
): boolean {
  const t = title?.trim()
  return !t || PLACEHOLDER_CURATOR_TITLES.has(t)
}

export function primeCuratorConversationInCache(
  queryClient: QueryClient,
  conversation: Conversation
) {
  queryClient.setQueryData<Conversation[]>(
    chatKeys.conversations(conversation.contactId),
    (current) => {
      if (!current) return [conversation]
      const filtered = current.filter((item) => item.id !== conversation.id)
      return [conversation, ...filtered]
    }
  )
  queryClient.setQueryData<Message[]>(
    chatKeys.messages(conversation.id),
    []
  )
}

type CreateConversationMutate = (params: {
  contactId: string
  title?: string
  contact?: Contact
}) => Promise<Conversation>

export async function createAndSelectCuratorConversation(options: {
  contact: Contact
  title?: string
  mutateAsync?: CreateConversationMutate
}): Promise<Conversation> {
  const { contact, title = CURATOR_DEFAULT_CONVERSATION_TITLE, mutateAsync } =
    options

  if (contact.type !== "curator" || !contact.curator?.id) {
    throw new Error("不是总管联系人")
  }

  const create =
    mutateAsync ??
    ((params) =>
      createConversation({
        contactId: params.contactId,
        title: params.title,
        contact: params.contact,
      }))

  const conversation = await create({
    contactId: contact.curator.id,
    title,
    contact,
  })

  selectConversationById(conversation.id)
  return conversation
}
