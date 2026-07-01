import type { UIMessage } from "ai"

import {
  getDbMessageIdFromAssistantMessage,
  HITL_APPROVE_MESSAGE_ID_META_KEY,
} from "./hitl/message-id"

type AssistantMeta = {
  streamState?: string
  mergedAssistantIds?: string[]
  hitlAnchorMessageId?: string
  approveMessageId?: string
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
    approveMessageId:
      typeof raw[HITL_APPROVE_MESSAGE_ID_META_KEY] === "string"
        ? raw[HITL_APPROVE_MESSAGE_ID_META_KEY]
        : undefined,
    approved_at:
      typeof raw.approved_at === "string" ? raw.approved_at : undefined,
  }
}

/**
 * 给一条消息末尾的 text part 补段落分隔(\n\n),用于合并时区分相邻轮次——
 * 否则分类器把相邻 text part 直接拼接(responseText += text),两轮文字会连成一段
 * (如「…完成后会自动同步结果。全部完成！…」)。末尾非 text(如工具)则不动。
 */
function withTrailingParagraphBreak(
  parts: UIMessage["parts"]
): UIMessage["parts"] {
  if (parts.length === 0) return parts
  const lastIdx = parts.length - 1
  const last = parts[lastIdx]
  if (
    last &&
    last.type === "text" &&
    typeof (last as { text?: unknown }).text === "string" &&
    !(last as { text: string }).text.endsWith("\n")
  ) {
    const cloned = {
      ...last,
      text: (last as { text: string }).text + "\n\n",
    }
    return [...parts.slice(0, lastIdx), cloned] as UIMessage["parts"]
  }
  return parts
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
  const approveMessageId =
    (interrupted && getDbMessageIdFromAssistantMessage(interrupted)) ||
    getDbMessageIdFromAssistantMessage(last)
  const mergedIds = group.map((m) => m.id)

  const baseMeta =
    (last as UIMessage & { metadata?: Record<string, unknown> }).metadata ?? {}

  const mergedMeta: Record<string, unknown> = {
    ...baseMeta,
    streamState: lastMeta.streamState,
    mergedAssistantIds: mergedIds,
    hitlAnchorMessageId,
  }
  if (approveMessageId) {
    mergedMeta[HITL_APPROVE_MESSAGE_ID_META_KEY] = approveMessageId
  }

  return {
    ...first,
    id: first.id,
    role: "assistant",
    // 非最后一条补段落分隔,区分相邻轮次(末条/流式中那条不加)。
    parts: group.flatMap((m, i) =>
      i === group.length - 1 ? m.parts : withTrailingParagraphBreak(m.parts)
    ),
    metadata: mergedMeta,
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
    // user 消息是气泡边界：先 flush 当前 assistant 组，再原样 push。
    flush()
    result.push(message)
  }
  flush()
  return result
}
