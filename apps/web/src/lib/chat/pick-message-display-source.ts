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
 * 流式重放期，composer 末条 assistant 常被清成空壳（resetLastAssistantPartsForResume，
 * 为 SDK 全量重放不丢不重）。此时若 DB 已有同 id 的已落 parts，用 DB 填回空壳，避免
 * 气泡塌空——delta 到达后 live 那条 parts 非空即不再回退。仅对 parts 为空的 assistant
 * 回退，非空 live 不动；无任何填充返回同引用。
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
    if (liveMsg.parts && liveMsg.parts.length > 0) return liveMsg
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
 * 流式期 composer（live）比 DB（stored）短时——典型场景：切走再切回后 useChat 以新
 * 会话 id 重置成空，resume 仅从后端 buffer 重建「当前轮」那一条 assistant——直接渲染
 * live 会把前面整段历史（上一轮 user+assistant）整体吞掉（「卡片之上、上一轮消息也缺失，
 * 二次进来才回来」的根因）。
 *
 * 修法：以 DB 时间线为底，对其中**也存在于 live** 的消息用 live 覆盖（live 持实时流式
 * parts，且空壳已先经 hydrateEmptyAssistantShellsFromDb 用 DB 回填）；仅在 live、不在 DB
 * 的消息（如尚未落库的乐观新条）按原相对顺序追加在末尾。如此历史不丢、当前轮仍实时。
 *
 * 仅当 live 确实「短于且为 stored 子集」时才走合并；其余情形（live≥stored 或两者发散）
 * 交回调用方既有分支，避免影响正常流式（live 持续增长追平 DB）的同引用 no-op。
 */
function mergeStreamingLiveOntoStoredHistory(
  liveMessages: UIMessage[],
  storedMessages: UIMessage[]
): UIMessage[] {
  const liveById = new Map<string, UIMessage>()
  for (const m of liveMessages) liveById.set(String(m.id), m)

  // 以 DB 时间线为底，live 同 id 覆盖（live 持实时 parts）。
  const merged = storedMessages.map((storedMsg) => {
    const live = liveById.get(String(storedMsg.id))
    return live ?? storedMsg
  })

  // live 独有（DB 还没有）的消息按原顺序补在末尾，保持当前轮实时增量可见。
  const storedIds = new Set(storedMessages.map((m) => String(m.id)))
  for (const liveMsg of liveMessages) {
    if (!storedIds.has(String(liveMsg.id))) merged.push(liveMsg)
  }

  return merged
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
    const hydrated = hydrateEmptyAssistantShellsFromDb(
      liveMessages,
      storedMessages
    )
    // live 比 DB 短且为其子集（切回后 resume 仅重建当前轮，composer 未追平 DB）→
    // 以 DB 历史为底合并，避免前面整段历史被吞。其余情形保持既有行为（同引用 no-op）。
    if (storedMessages.length > 0 && hydrated.length < storedMessages.length) {
      const storedIds = new Set(storedMessages.map((m) => String(m.id)))
      const liveAllInStored = hydrated.every((m) => storedIds.has(String(m.id)))
      if (liveAllInStored) {
        return mergeStreamingLiveOntoStoredHistory(hydrated, storedMessages)
      }
    }
    return hydrated
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
