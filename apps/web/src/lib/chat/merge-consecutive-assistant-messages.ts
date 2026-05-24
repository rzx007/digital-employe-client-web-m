import type { UIMessage } from "ai"

import { dedupeHitlPartsInMessages } from "@/lib/chat/hitl-abort-message-utils"

type AssistantMeta = {
  streamState?: string
  mergedAssistantIds?: string[]
  hitlAnchorMessageId?: string
  approved_at?: string
}

function getAssistantMeta(message: UIMessage): AssistantMeta {
  const raw = (message as UIMessage & { metadata?: Record<string, unknown> })
    .metadata
  if (!raw || typeof raw !== "object") return {}
  return {
    streamState:
      typeof raw.streamState === "string" ? raw.streamState : undefined,
    mergedAssistantIds: Array.isArray(raw.mergedAssistantIds)
      ? (raw.mergedAssistantIds as string[])
      : undefined,
    hitlAnchorMessageId:
      typeof raw.hitlAnchorMessageId === "string"
        ? raw.hitlAnchorMessageId
        : undefined,
    approved_at:
      typeof raw.approved_at === "string" ? raw.approved_at : undefined,
  }
}

function mergeAssistantGroup(group: UIMessage[]): UIMessage {
  const first = group[0]
  const last = group[group.length - 1]
  const lastMeta = getAssistantMeta(last)
  const interrupted = group.find((m) => {
    const meta = getAssistantMeta(m)
    return meta.streamState === "interrupted" && !meta.approved_at
  })
  const hitlAnchorMessageId = interrupted?.id ?? last.id
  const mergedIds = group.map((m) => m.id)

  const baseMeta =
    (last as UIMessage & { metadata?: Record<string, unknown> }).metadata ?? {}

  return {
    ...first,
    id: first.id,
    role: "assistant",
    parts: group.flatMap((m) => m.parts),
    metadata: {
      ...baseMeta,
      streamState: lastMeta.streamState,
      mergedAssistantIds: mergedIds,
      hitlAnchorMessageId,
    },
  } as UIMessage
}

/**
 * 同一用户轮次内（上一 user 与下一 user 之间）连续的 assistant 行合并为一条气泡，
 * 含 `stream_state === "streaming"` 的行（HITL 封存段 + 正在写的段同一泡展示）。
 */
export function mergeConsecutiveAssistantMessages(
  messages: UIMessage[]
): UIMessage[] {
  const result: UIMessage[] = []
  let group: UIMessage[] = []

  const flush = () => {
    if (group.length === 0) return
    result.push(group.length === 1 ? group[0] : mergeAssistantGroup(group))
    group = []
  }

  for (const message of messages) {
    if (message.role === "assistant") {
      group.push(message)
      continue
    }
    flush()
    result.push(message)
  }
  flush()
  return result
}

/** 列表渲染：先去重 HITL part，再合并连续 assistant 气泡 */
export function prepareDisplayMessages(messages: UIMessage[]): UIMessage[] {
  return mergeConsecutiveAssistantMessages(dedupeHitlPartsInMessages(messages))
}
