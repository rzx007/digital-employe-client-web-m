import type { UIMessage } from "ai"

import type { Message } from "@/lib/mock-data/messages"

import { classifyMessageParts } from "./message-classifier"
import { enrichAssistantPartsFromStoredMessage } from "./stored-message-hitl-utils"

export {
  classifyMessageParts,
  type ClassifiedBlock,
  type ToolGroupItem,
} from "./message-classifier"

export function getTextFromUIMessage(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

/** 提取适合复制到剪贴板的可读正文（不含工具块、思考过程等） */
export function getCopyableMessageText(
  message: UIMessage,
  options?: { includeFileChanges?: boolean }
): string {
  const blocks = classifyMessageParts(message, options)
  const parts: string[] = []
  for (const block of blocks) {
    if (block.kind === "final-response" || block.kind === "error") {
      const t = block.text.trim()
      if (t) parts.push(t)
    }
  }
  if (parts.length > 0) return parts.join("\n\n")
  return getTextFromUIMessage(message).trim()
}

export function mapStoredMessagesToUIMessages(
  messages: Message[]
): UIMessage[] {
  return messages
    .map((message): UIMessage | null => {
      const messageMeta =
        message.metadata && typeof message.metadata === "object"
          ? (message.metadata as Record<string, unknown>)
          : undefined

      if (message.role === "assistant") {
        const assistantMeta = {
          ...messageMeta,
          streamState: message.streamState ?? undefined,
        }
        if (message.messageParts && message.messageParts.length > 0) {
          const baseParts = message.messageParts as UIMessage["parts"]
          const parts = enrichAssistantPartsFromStoredMessage(message, baseParts)
          const uiMessage: UIMessage = {
            id: message.id,
            role: message.role,
            parts,
          }
          ;(
            uiMessage as UIMessage & { metadata?: Record<string, unknown> }
          ).metadata = assistantMeta
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
          ;(
            uiMessage as UIMessage & { metadata?: Record<string, unknown> }
          ).metadata = assistantMeta
          return uiMessage
        }

        if (message.streamState === "streaming") {
          const uiMessage: UIMessage = {
            id: message.id,
            role: message.role,
            parts: [],
          }
          ;(
            uiMessage as UIMessage & { metadata?: Record<string, unknown> }
          ).metadata = assistantMeta
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
      ;(
        uiMessage as UIMessage & { metadata?: Record<string, unknown> }
      ).metadata = messageMeta
      return uiMessage
    })
    .filter((message): message is UIMessage => message !== null)
}
