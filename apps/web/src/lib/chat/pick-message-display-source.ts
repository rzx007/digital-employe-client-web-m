import type { UIMessage } from "ai"

import { isTerminalAssistantStreamState } from "./assistant-stream-state"
import { parseDbMessageId } from "./hitl/message-id"

function lastDbMessageId(messages: UIMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg) continue
    const parsed = parseDbMessageId(msg.id)
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
  if (shouldForceHydrateFromStored(liveMessages, storedMessages)) return true
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

function readMetadata(
  message: UIMessage | undefined
): Record<string, unknown> | undefined {
  if (!message) return undefined
  return (message as MessageWithMeta).metadata
}

function lastAssistantMessage(
  messages: UIMessage[]
): MessageWithMeta | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") {
      return messages[i] as MessageWithMeta
    }
  }
  return undefined
}

function assistantTextLength(message: UIMessage | undefined): number {
  if (!message?.parts?.length) return 0
  return message.parts.reduce((sum, part) => {
    if (part.type === "text" && typeof part.text === "string") {
      return sum + part.text.length
    }
    return sum
  }, 0)
}

/** DB 已终态但 composer 仍残留 queued/streaming 占位时，必须从 DB 覆盖。 */
export function shouldForceHydrateFromStored(
  liveMessages: UIMessage[],
  storedMessages: UIMessage[]
): boolean {
  if (storedMessages.length === 0) return false

  const storedLast = lastAssistantMessage(storedMessages)
  if (!storedLast) return false

  const storedState = readMetadata(storedLast)?.streamState
  if (
    typeof storedState !== "string" ||
    !isTerminalAssistantStreamState(storedState)
  ) {
    return false
  }

  const liveLast = lastAssistantMessage(liveMessages)
  if (!liveLast) return true

  const liveState = readMetadata(liveLast)?.streamState
  if (liveState !== storedState) return true

  return assistantTextLength(storedLast) > assistantTextLength(liveLast)
}

/** DB 为 queued 但 composer 残留 streaming/其他状态时，展示 DB 快照。 */
export function shouldPreferStoredOverStaleComposer(
  liveMessages: UIMessage[],
  storedMessages: UIMessage[]
): boolean {
  if (shouldForceHydrateFromStored(liveMessages, storedMessages)) return true
  const storedLast = lastAssistantMessage(storedMessages)
  if (!storedLast) return false
  if (readMetadata(storedLast)?.streamState !== "queued") return false
  const liveLast = lastAssistantMessage(liveMessages)
  if (!liveLast) return true
  return readMetadata(liveLast)?.streamState !== "queued"
}

function isInterruptedAwaitingApproval(
  meta: Record<string, unknown> | undefined
): boolean {
  return (
    meta?.streamState === "interrupted" &&
    (typeof meta?.approved_at !== "string" || meta.approved_at.length === 0)
  )
}

function storedMessageIndexByDbId(
  storedMessages: UIMessage[]
): Map<string, UIMessage> {
  const map = new Map<string, UIMessage>()
  for (const msg of storedMessages) {
    const dbId = parseDbMessageId(msg.id)
    if (dbId != null) map.set(String(dbId), msg)
  }
  return map
}

/**
 * 待审批的 interrupted 行：composer 以 DB message_parts 为准（与 interrupt SSE 落库一致）。
 */
export function applyStoredPartsToInterruptedAssistants(
  liveMessages: UIMessage[],
  storedMessages: UIMessage[]
): UIMessage[] {
  if (liveMessages.length === 0 || storedMessages.length === 0) {
    return liveMessages
  }

  const storedById = storedMessageIndexByDbId(storedMessages)
  let changed = false

  const next = liveMessages.map((liveMsg) => {
    if (liveMsg.role !== "assistant") return liveMsg
    const liveMeta = readMetadata(liveMsg)
    if (!isInterruptedAwaitingApproval(liveMeta)) return liveMsg

    const dbId = parseDbMessageId(liveMsg.id)
    if (dbId == null) return liveMsg

    const stored = storedById.get(String(dbId))
    if (!stored?.parts?.length) return liveMsg

    changed = true
    return {
      ...liveMsg,
      parts: stored.parts,
      metadata: {
        ...liveMeta,
        ...(readMetadata(stored) ?? {}),
        streamState: "interrupted",
      },
    } as UIMessage
  })

  return changed ? next : liveMessages
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

    const shouldSyncInterruptedParts =
      liveMsg.role === "assistant" &&
      isInterruptedAwaitingApproval(liveMeta) &&
      isInterruptedAwaitingApproval(storedMeta) &&
      (storedMsg.parts?.length ?? 0) > 0

    const storedTerminal = isTerminalAssistantStreamState(
      typeof storedMeta?.streamState === "string"
        ? storedMeta.streamState
        : undefined
    )
    const shouldSyncTerminalParts =
      liveMsg.role === "assistant" &&
      storedTerminal &&
      (storedMeta?.streamState !== liveMeta?.streamState ||
        assistantTextLength(storedMsg) > assistantTextLength(liveMsg))

    if (
      !shouldPatchId &&
      !shouldPatchMeta &&
      !shouldSyncInterruptedParts &&
      !shouldSyncTerminalParts
    ) {
      return liveMsg
    }

    changed = true
    const patched: MessageWithMeta = {
      ...liveMsg,
      id: shouldPatchId ? storedMsg.id : liveMsg.id,
      ...(shouldSyncInterruptedParts || shouldSyncTerminalParts
        ? { parts: storedMsg.parts }
        : {}),
    }
    if (
      shouldPatchMeta ||
      shouldPatchId ||
      shouldSyncInterruptedParts ||
      shouldSyncTerminalParts
    ) {
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

/** DB 仍在 streaming 但 live 未接上/落后时，展示 DB checkpoint 正文（群深链旁观执行）。 */
export function shouldPreferStoredWhileDbStreaming(
  liveMessages: UIMessage[],
  storedMessages: UIMessage[]
): boolean {
  const storedLast = lastAssistantMessage(storedMessages)
  if (readMetadata(storedLast)?.streamState !== "streaming") return false
  const liveLast = lastAssistantMessage(liveMessages)
  if (!liveLast) return storedMessages.length > 0
  if (readMetadata(liveLast)?.streamState === "queued") return true
  return assistantTextLength(storedLast) > assistantTextLength(liveLast)
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
  status: string,
  options?: { preferStoredWhileDbStreaming?: boolean }
): UIMessage[] {
  if (status === "streaming" || status === "submitted") {
    if (shouldPreferStoredOverStaleComposer(liveMessages, storedMessages)) {
      return storedMessages.length > 0 ? storedMessages : liveMessages
    }
    return liveMessages
  }

  if (
    options?.preferStoredWhileDbStreaming &&
    shouldPreferStoredWhileDbStreaming(liveMessages, storedMessages)
  ) {
    return storedMessages
  }

  let source = liveMessages

  if (source.length === 0) {
    source = storedMessages
  } else if (storedMessages.length === 0) {
    source = liveMessages
  } else if (source.length > storedMessages.length) {
    source = liveMessages
  } else if (source.length === storedMessages.length) {
    source = applyStoredPartsToInterruptedAssistants(
      liveMessages,
      storedMessages
    )
  } else {
    const storedLastId = lastDbMessageId(storedMessages)
    const liveLastId = lastDbMessageId(liveMessages)
    source =
      storedLastId > liveLastId ? storedMessages : liveMessages
    if (source === liveMessages) {
      source = applyStoredPartsToInterruptedAssistants(
        liveMessages,
        storedMessages
      )
    }
  }

  return source
}
