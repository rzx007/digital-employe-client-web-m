import type { UIMessage } from "ai"

import type { Message } from "@/lib/mock-data/messages"

export { classifyMessageParts, type ClassifiedBlock, type ToolGroupItem } from "./message-classifier"

export function getTextFromUIMessage(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

export function mapStoredMessagesToUIMessages(
  messages: Message[]
): UIMessage[] {
  return messages.map((message): UIMessage | null => {
    const messageMeta =
      message.metadata && typeof message.metadata === "object"
        ? (message.metadata as Record<string, unknown>)
        : undefined

    if (message.role === "assistant") {
      if (message.messageParts && message.messageParts.length > 0) {
        const uiMessage: UIMessage = {
          id: message.id,
          role: message.role,
          parts: message.messageParts as UIMessage["parts"],
        }
          ; (uiMessage as UIMessage & { metadata?: Record<string, unknown> }).metadata =
            messageMeta
        return uiMessage
      }

      if (message.content) {
        const uiMessage: UIMessage = {
          id: message.id,
          role: message.role,
          parts: [
            {
              type: "text",
              text: message.content,
              state: "done" as const,
            },
          ],
        }
          ; (uiMessage as UIMessage & { metadata?: Record<string, unknown> }).metadata =
            messageMeta
        return uiMessage
      }

      if (message.streamState === "streaming") {
        const uiMessage: UIMessage = {
          id: message.id,
          role: message.role,
          parts: [],
        }
          ; (uiMessage as UIMessage & { metadata?: Record<string, unknown> }).metadata =
            messageMeta
        return uiMessage
      }

      return null
    }

    const uiMessage: UIMessage = {
      id: message.id,
      role: message.role,
      parts: [
        {
          type: "text",
          text: message.content,
          state: "done",
        },
      ],
    }
      ; (uiMessage as UIMessage & { metadata?: Record<string, unknown> }).metadata =
        messageMeta
    return uiMessage
  }).filter((message): message is UIMessage => message !== null)
}
