import type { UIMessage } from "ai"

import type { Message } from "@/types/chat"

import { classifyMessageParts } from "./message-classifier"
import { shouldHideStaleQueuePlaceholder } from "./assistant-stream-state"
import {
  HITL_APPROVE_MESSAGE_ID_META_KEY,
  parseDbMessageId,
} from "./hitl/message-id"

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
    if (
      block.kind === "final-response" ||
      block.kind === "error" ||
      block.kind === "user-action-summary"
    ) {
      const t = block.text.trim()
      if (t) parts.push(t)
    }
  }
  if (parts.length > 0) return parts.join("\n\n")
  return getTextFromUIMessage(message).trim()
}

/**
 * 历史数据里的 message_parts 可能损坏（非数组 / part 缺 type）。
 * 校验失败时返回 null，让调用方安全回退到 content，避免把坏数据塞进渲染导致整屏崩溃。
 */
function sanitizeStoredParts(raw: unknown): UIMessage["parts"] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const allValid = raw.every(
    (part) =>
      part != null &&
      typeof part === "object" &&
      typeof (part as { type?: unknown }).type === "string"
  )
  return allValid ? (raw as UIMessage["parts"]) : null
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
        const assistantMeta: Record<string, unknown> = {
          ...messageMeta,
          streamState: message.streamState ?? undefined,
          approved_at:
            typeof messageMeta?.approved_at === "string"
              ? messageMeta.approved_at
              : undefined,
        }
        const dbId = parseDbMessageId(message.id)
        if (
          dbId &&
          message.streamState === "interrupted" &&
          typeof assistantMeta.approved_at !== "string"
        ) {
          assistantMeta[HITL_APPROVE_MESSAGE_ID_META_KEY] = dbId
        }
        const storedParts = sanitizeStoredParts(message.messageParts)
        if (storedParts) {
          // 仅有工具 parts、无 text part 时，仍应展示 DB content（组长群投影常见：
          // message_parts 只有 create_orchestration_plan / 澄清工具，content 有说明文字）。
          const hasTextPart = storedParts.some(
            (part) =>
              part.type === "text" &&
              "text" in part &&
              typeof part.text === "string" &&
              part.text.trim().length > 0
          )
          const parts: UIMessage["parts"] =
            !hasTextPart &&
            message.content?.trim() &&
            message.streamState !== "streaming"
              ? [
                  {
                    type: "text",
                    text: message.content,
                    state: "done" as const,
                  },
                  ...storedParts,
                ]
              : storedParts
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

        // 流式进行中不渲染 DB.content：它是后端把每个 text chunk（含工具输出文本，如
        // shell 结果 / 技能原文）平铺拼接的无结构脏文本，直接当正文会糊出一坨原始 dump，
        // 且 state:"done" 还会和随后 resume SSE 的实时结构块打架。进行中内容由 resume SSE
        // 重放 buffer 重建（见下方 streaming 占位分支）；content 仅作历史/终态无 message_parts
        // 时的兜底。
        if (message.content && message.streamState !== "streaming") {
          if (
            shouldHideStaleQueuePlaceholder(
              message.streamState,
              message.content
            )
          ) {
            // 陈旧的队列占位提示（如"已加入执行队列"）：不渲染这条，也不塞"正在执行…"。
            return null
          }
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
          if (
            message.content &&
            shouldHideStaleQueuePlaceholder(
              message.streamState,
              message.content
            )
          ) {
            // 队列占位提示仍不渲染：顶部指示器 + SSE 接管即可。
            return null
          }
          // 进行中且尚无结构化 parts：保留空壳占位（id + streamState），供切回会话时
          // resume / hydrateEmptyAssistantShellsFromDb 按 db id 对齐；不在 parts 里塞
          // 脏 content（后端平铺 chunk 无结构）。可见内容由 SSE 或 DB message_parts 补全。
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
