import type { UIMessage } from "ai"

import { findContactInList } from "@/lib/mock-data/ai-employees"
import { LangChainChatTransport } from "@/lib/chat/langchain-chat-transport"

export const chatTransport = new LangChainChatTransport<UIMessage>()

export type ChatViewContact = NonNullable<ReturnType<typeof findContactInList>>

export function getContactDisplayName(contact: ChatViewContact) {
  if (contact.type === "group") {
    return contact.group?.name ?? "群组"
  }

  if (contact.type === "curator") {
    return contact.curator?.name ?? "AI 助手"
  }

  return contact.employee?.name ?? "AI 助手"
}
