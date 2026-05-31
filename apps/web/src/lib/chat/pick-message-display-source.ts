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

type MessageWithMeta = UIMessage & {
  metadata?: Record<string, unknown>
}

function readMetadata(message: UIMessage): Record<string, unknown> | undefined {
  return (message as MessageWithMeta).metadata
}

/** 同轮对话 DB refetch 后，只同步 id / streamState，保留 composer 里 SSE 累积的 parts，避免整表替换闪屏。 */
export function patchComposerFromStoredWhenSameTurn(
  liveMessages: UIMessage[],
  storedMessages: UIMessage[]
): UIMessage[] | null {
  if (liveMessages.length === 0 || storedMessages.length === 0) {
    return null
  }
  if (storedMessages.length !== liveMessages.length) {
    return null
  }

  let changed = false
  const next = liveMessages.map((liveMsg, index) => {
    const storedMsg = storedMessages[index]
    if (!storedMsg || liveMsg.role !== storedMsg.role) {
      return liveMsg
    }

    const liveDbId = parseDbMessageId(liveMsg.id)
    const storedDbId = parseDbMessageId(storedMsg.id)
    const shouldPatchId =
      storedDbId != null &&
      (liveDbId == null || liveMsg.id !== storedMsg.id)

    const liveMeta = readMetadata(liveMsg)
    const storedMeta = readMetadata(storedMsg)
    const nextStreamState =
      typeof storedMeta?.streamState === "string"
        ? storedMeta.streamState
        : liveMeta?.streamState

    const shouldPatchMeta =
      nextStreamState !== liveMeta?.streamState ||
      (storedMeta?.approved_at !== liveMeta?.approved_at &&
        storedMeta?.approved_at != null)

    if (!shouldPatchId && !shouldPatchMeta) {
      return liveMsg
    }

    changed = true
    const patched: MessageWithMeta = {
      ...liveMsg,
      id: shouldPatchId ? storedMsg.id : liveMsg.id,
    }
    if (shouldPatchMeta || shouldPatchId) {
      patched.metadata = {
        ...liveMeta,
        ...storedMeta,
        ...(nextStreamState != null ? { streamState: nextStreamState } : {}),
      }
    }
    return patched
  })

  return changed ? next : null
}

/**
 * 流式结束后展示来源：
 * - 流式中用 live composer
 * - 结束后若 composer 已包含完整轮次，继续用 live（DB refetch 仅后台同步）
 * - 仅当 live 明显落后于 DB（stop 后变短、重进会话）才切 stored
 */
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
  if (liveMessages.length > storedMessages.length) {
    return liveMessages
  }
  if (liveMessages.length === storedMessages.length) {
    return liveMessages
  }

  const storedLastId = lastDbMessageId(storedMessages)
  const liveLastId = lastDbMessageId(liveMessages)

  if (storedLastId > liveLastId) {
    return storedMessages
  }
  return liveMessages
}
