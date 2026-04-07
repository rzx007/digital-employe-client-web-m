import type { UIMessage } from "ai"

import { findContactInList } from "@/lib/mock-data/ai-employees"
import { LangChainChatTransport } from "@/lib/chat/langchain-chat-transport"
import type { Artifact } from "@/types/artifact"

export const chatTransport = new LangChainChatTransport<UIMessage>()

export type ChatViewContact = NonNullable<ReturnType<typeof findContactInList>>

export type MessageMetadata = {
  artifactToolCallId?: string
  artifact?: Artifact
}

export function isMessageMetadata(
  metadata: unknown
): metadata is MessageMetadata {
  return typeof metadata === "object" && metadata !== null
}

export function getContactDisplayName(contact: ChatViewContact) {
  if (contact.type === "group") {
    return contact.group?.name ?? "群组"
  }

  if (contact.type === "curator") {
    return contact.curator?.name ?? "AI 助手"
  }

  return contact.employee?.name ?? "AI 助手"
}
