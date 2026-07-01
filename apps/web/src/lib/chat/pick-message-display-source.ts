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

function isInterruptedAwaitingApproval(
  meta: Record<string, unknown> | undefined
): boolean {
  return (
    meta?.streamState === "interrupted" &&
    (typeof meta?.approved_at !== "string" || meta.approved_at.length === 0)
  )
}

function liveHasOnlyTextParts(parts: UIMessage["parts"]): boolean {
  if (!parts?.length) return false
  return parts.every(
    (part) => part.type === "text" || part.type === "reasoning"
  )
}

function storedHasStructuredToolParts(parts: UIMessage["parts"]): boolean {
  if (!parts?.length) return false
  return parts.some(
    (part) =>
      typeof part.type === "string" &&
      (part.type.startsWith("tool-") || part.type === "dynamic-tool")
  )
}

/**
 * live 仅有 text/reasoning、DB 同 id 已有 tool parts 时，用 DB 结构化 parts 替换，
 * 避免切回会话后只显示纯文字、工具卡/组件缺失（SSE 断线前 composer 可能只累积了 text）。
 */
export function preferStoredStructuredPartsWhenLiveTextOnly(
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
    const liveParts = liveMsg.parts ?? []
    if (!liveHasOnlyTextParts(liveParts)) return liveMsg

    const dbId = parseDbMessageId(liveMsg.id)
    if (dbId == null) return liveMsg

    const stored = storedById.get(String(dbId))
    const storedParts = stored?.parts ?? []
    if (
      !storedHasStructuredToolParts(storedParts) ||
      storedParts.length <= liveParts.length
    ) {
      return liveMsg
    }

    changed = true
    return {
      ...liveMsg,
      parts: storedParts,
      metadata: {
        ...readMetadata(liveMsg),
        ...(readMetadata(stored) ?? {}),
      },
    } as UIMessage
  })

  return changed ? next : liveMessages
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

    if (!shouldPatchId && !shouldPatchMeta && !shouldSyncInterruptedParts) {
      return liveMsg
    }

    changed = true
    const patched: MessageWithMeta = {
      ...liveMsg,
      id: shouldPatchId ? storedMsg.id : liveMsg.id,
      ...(shouldSyncInterruptedParts ? { parts: storedMsg.parts } : {}),
    }
    if (shouldPatchMeta || shouldPatchId || shouldSyncInterruptedParts) {
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
 * 重放期 / 服务端发起的总管 turn（增量汇报「回调通知」）期间，composer 末条 assistant 常被
 * 清成空壳（resetLastAssistantPartsForResume，为 SDK 全量重放不丢不重）。此时若 DB 已有同 id
 * 的已落 parts，用 DB 填回空壳，避免气泡塌空——delta 到达后 live 那条 parts 非空即不再回退。
 *
 * 仅对 parts 为空的 assistant 回退，非空 live 不动（保留 SSE 实时累积）；无任何填充返回同引用。
 * 与 streaming 短路无关：服务端发起的 turn 走 resume，常回 no_stream→末条留空壳、status 回 ready，
 * 内容只在 DB；不在此回退则要切走再切回（remount 重灌 DB）才显示。
 */
export function hydrateEmptyAssistantShellsFromDb(
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
    if ((liveMsg.parts?.length ?? 0) > 0) return liveMsg

    const dbId = parseDbMessageId(liveMsg.id)
    if (dbId == null) return liveMsg

    const stored = storedById.get(String(dbId))
    if (!stored?.parts?.length) return liveMsg

    changed = true
    return { ...liveMsg, parts: stored.parts } as UIMessage
  })

  return changed ? next : liveMessages
}

/**
 * 流式结束后展示来源：
 * - 流式中用 live composer
 * - 结束后若 composer 已包含完整轮次，继续用 live（DB refetch 仅后台同步）
 * - 仅当 live 明显落后于 DB（stop 后变短、重进会话）才切 stored
 *
 * 末一步统一对选中源里的「空壳 assistant」按 db id 从 DB 回退 parts：覆盖重放期
 * （streaming）与服务端发起 turn 走 resume→no_stream 后留下的空壳（status 已回 ready、
 * 等长分支只 patch interrupted 行够不到它）。非空 live 不动，故对正常路径是 no-op。
 */
export function pickMessageDisplaySource(
  liveMessages: UIMessage[],
  storedMessages: UIMessage[],
  status: string
): UIMessage[] {
  if (status === "streaming" || status === "submitted") {
    if (
      liveMessages.length === 0 ||
      messagesNeedHydrateFromDb(liveMessages, storedMessages)
    ) {
      const merged =
        patchComposerFromStoredWhenSameTurn(liveMessages, storedMessages) ??
        storedMessages
      return preferStoredStructuredPartsWhenLiveTextOnly(
        hydrateEmptyAssistantShellsFromDb(merged, storedMessages),
        storedMessages
      )
    }
    const hydrated = hydrateEmptyAssistantShellsFromDb(
      liveMessages,
      storedMessages
    )
    return preferStoredStructuredPartsWhenLiveTextOnly(hydrated, storedMessages)
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

  source = preferStoredStructuredPartsWhenLiveTextOnly(source, storedMessages)

  return hydrateEmptyAssistantShellsFromDb(source, storedMessages)
}
