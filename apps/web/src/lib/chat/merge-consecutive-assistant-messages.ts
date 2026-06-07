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
  senderName?: string
  senderId?: string
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
    senderName: typeof raw.senderName === "string" ? raw.senderName : undefined,
    senderId: typeof raw.senderId === "string" ? raw.senderId : undefined,
  }
}

/**
 * 群时间线里每条 assistant 消息都是某发言人（组长/某成员）的一条独立、完整的
 * 发言，彼此即便发言人相同（如组长「已收到」+ 组长正式回复）也是两轮，绝不能并到
 * 同一气泡。带 senderName/senderId 的消息即来自群投影，一律单独成泡；单聊消息两者
 * 皆空，相邻 assistant 仍按原逻辑（HITL 封存段 + 续写段同泡）合并。
 */
function isGroupTimelineMessage(message: UIMessage): boolean {
  const meta = getAssistantMeta(message)
  return Boolean(meta.senderId || meta.senderName)
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
    parts: group.flatMap((m) => m.parts),
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
    if (message.role === "assistant" && !isGroupTimelineMessage(message)) {
      group.push(message)
      continue
    }
    // user 消息、或群时间线里任何一条独立 assistant 发言：都是气泡边界。
    // 群消息各自单独成泡（不与前后任何消息合并），故先 flush 再原样 push。
    flush()
    result.push(message)
  }
  flush()
  return result
}
