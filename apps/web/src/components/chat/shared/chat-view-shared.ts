import type { UIMessage } from "ai"
import { formatDuration, intervalToDuration } from "date-fns"
import { zhCN } from "date-fns/locale"

import { findContactInList } from "@/lib/chat/contact-utils"
import { LangChainChatTransport } from "@/lib/chat/langchain-chat-transport"

export const chatTransport = new LangChainChatTransport<UIMessage>()

export type ChatViewContact = NonNullable<ReturnType<typeof findContactInList>>

export function getContactDisplayName(contact: ChatViewContact) {
  if (contact.type === "curator") {
    return contact.curator?.name ?? "AI 助手"
  }

  return contact.employee?.name ?? "AI 助手"
}

export type CommandMeta = { id?: string; title?: string } | null
export type MentionMeta = Array<{ id?: string; name?: string }>
export type FileMeta = Array<{ name: string; path: string }>

export type StoredMessageTimestampSource = {
  id: string
  metadata?: Record<string, unknown>
  timestamp?: Date
}

export function getMessageCreatedAtMs(
  message: UIMessage,
  storedMessages?: StoredMessageTimestampSource[]
): number | null {
  const meta = getMessageMetadataRecord(message)
  const createdAt = meta?.created_at
  if (typeof createdAt === "string" || createdAt instanceof Date) {
    const ms = new Date(createdAt).getTime()
    return Number.isFinite(ms) ? ms : null
  }

  const stored = storedMessages?.find((m) => m.id === message.id)
  if (stored?.timestamp) {
    const ms = stored.timestamp.getTime()
    return Number.isFinite(ms) ? ms : null
  }

  const storedCreatedAt = stored?.metadata?.created_at
  if (typeof storedCreatedAt === "string" || storedCreatedAt instanceof Date) {
    const ms = new Date(storedCreatedAt).getTime()
    return Number.isFinite(ms) ? ms : null
  }

  return null
}

export function getMessageMetadataRecord(
  message: UIMessage
): Record<string, unknown> | null {
  if (!message || typeof message !== "object") return null
  const meta = (message as unknown as Record<string, unknown>).metadata
  return meta && typeof meta === "object"
    ? (meta as Record<string, unknown>)
    : null
}

export function getMessageMeta(message: UIMessage): {
  command?: CommandMeta
  mentions?: MentionMeta
  files?: FileMeta
} | null {
  const meta = getMessageMetadataRecord(message)
  return meta
    ? (meta as {
        command?: CommandMeta
        mentions?: MentionMeta
        files?: FileMeta
      })
    : null
}

/** 后端 extra_meta.elapsed_ms：agent 流式回复耗时（毫秒） */
export function getElapsedMsFromMeta(message: UIMessage): number | null {
  const meta = getMessageMetadataRecord(message)
  if (!meta) return null
  const elapsed = meta.elapsed_ms
  if (typeof elapsed === "number" && Number.isFinite(elapsed) && elapsed >= 0) {
    return Math.round(elapsed)
  }
  if (typeof elapsed === "string") {
    const n = Number(elapsed)
    if (Number.isFinite(n) && n >= 0) return Math.round(n)
  }
  return null
}

export function formatElapsedMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`

  const duration = intervalToDuration({ start: 0, end: ms })
  const formatUnits: Array<"hours" | "minutes" | "seconds"> =
    ms >= 3_600_000
      ? ["hours", "minutes", "seconds"]
      : ms >= 60_000
        ? ["minutes", "seconds"]
        : ["seconds"]

  return (
    formatDuration(duration, { locale: zhCN, format: formatUnits }) || `${ms}ms`
  )
}

/** 当前轮 live 最后一泡：隐藏复制/耗时，等内容稳定后再展示 */
export function shouldShowAssistantMessageActions(
  isLastAssistantMessage: boolean,
  isTurnEnded: boolean
): boolean {
  return !isLastAssistantMessage || isTurnEnded
}

export function shouldShowMessageElapsed(
  elapsedMs: number | null,
  isLastAssistantMessage: boolean,
  isTurnEnded: boolean
): boolean {
  if (elapsedMs == null) return false
  return shouldShowAssistantMessageActions(isLastAssistantMessage, isTurnEnded)
}

export function shouldShowMessageCopy(
  isLastAssistantMessage: boolean,
  isTurnEnded: boolean
): boolean {
  return shouldShowAssistantMessageActions(isLastAssistantMessage, isTurnEnded)
}
