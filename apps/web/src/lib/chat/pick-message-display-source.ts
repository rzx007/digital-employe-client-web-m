import type { UIMessage } from "ai"

import { parseDbMessageId } from "./hitl/message-id"

function lastDbMessageId(messages: UIMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const parsed = parseDbMessageId(messages[i].id)
    if (parsed != null) {
      const n = Number(parsed)
      if (Number.isFinite(n)) return n
    }
  }
  return -1
}

export function messagesNeedHydrateFromDb(
  liveMessages: UIMessage[],
  storedMessages: UIMessage[]
): boolean {
  if (storedMessages.length === 0) return false
  if (liveMessages.length === 0) return true
  if (storedMessages.length > liveMessages.length) return true
  return lastDbMessageId(storedMessages) > lastDbMessageId(liveMessages)
}

export function hydrateSignature(messages: UIMessage[]): string {
  if (messages.length === 0) return "empty"
  return `${messages.length}:${lastDbMessageId(messages)}`
}

/** 流式结束后优先用 DB 全量历史，避免 stop/abort 或切会话后 composer 残留旧状态。 */
export function pickMessageDisplaySource(
  liveMessages: UIMessage[],
  storedMessages: UIMessage[],
  status: string
): UIMessage[] {
  if (status === "streaming" || status === "submitted") {
    return liveMessages
  }
  if (liveMessages.length === 0) {
    return storedMessages
  }
  if (storedMessages.length === 0) {
    return liveMessages
  }

  const storedLastId = lastDbMessageId(storedMessages)
  const liveLastId = lastDbMessageId(liveMessages)

  if (storedLastId > liveLastId) {
    return storedMessages
  }
  if (storedMessages.length > liveMessages.length) {
    return storedMessages
  }
  return liveMessages
}
