import type { UIMessage } from "ai"

import type { Message } from "@/lib/mock-data/messages"

export { classifyMessageParts, type ClassifiedBlock, type ToolGroupItem } from "./message-classifier"

export function getTextFromUIMessage(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

// --- 将存储的消息列表转换为 UIMessage 列表 ---
//
// 优先使用服务端预计算的 messageParts（方案A：_flush_terminal 提取），
// 确保 text 和 tool 的正确交错顺序。无需前端解析 LangChain chunk。

export function mapStoredMessagesToUIMessages(
  messages: Message[]
): UIMessage[] {
  return messages.map((message): UIMessage | null => {
    const messageMeta =
      message.metadata && typeof message.metadata === "object"
        ? (message.metadata as Record<string, unknown>)
        : undefined

    if (message.role === "assistant") {
      // 服务端预计算的结构化 parts（最优路径）
      if (message.messageParts && message.messageParts.length > 0) {
        const uiMessage: UIMessage = {
          id: message.id,
          role: message.role,
          parts: message.messageParts as UIMessage["parts"],
        }
        ;(uiMessage as UIMessage & { metadata?: Record<string, unknown> }).metadata =
          messageMeta
        return uiMessage
      }

      // 降级：纯文本
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
        ;(uiMessage as UIMessage & { metadata?: Record<string, unknown> }).metadata =
          messageMeta
        return uiMessage
      }

      // 流式未完成
      if (message.streamState === "streaming") {
        const uiMessage: UIMessage = {
          id: message.id,
          role: message.role,
          parts: [],
        }
        ;(uiMessage as UIMessage & { metadata?: Record<string, unknown> }).metadata =
          messageMeta
        return uiMessage
      }

      return null
    }

    // user 等其他 role：使用 content 作为纯文本 part
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
    ;(uiMessage as UIMessage & { metadata?: Record<string, unknown> }).metadata =
      messageMeta
    return uiMessage
  }).filter((message): message is UIMessage => message !== null)
}
