import type { UIMessage } from "ai"

import { CLARIFY_TOOL_NAME } from "./constants"
import { extractClarifyInputFromMessageParts } from "./clarifying-questions"
import { resolveGroupClarifyTarget } from "./group-clarify-target"
import { parseDbMessageId } from "./message-id"
import { seedActiveHitlFromMessageParts, type ActiveHitl } from "./active-hitl"
import { toolPartHasFinalOutput } from "./part-utils"

const CLARIFY_TOOL_TYPE = `tool-${CLARIFY_TOOL_NAME}`

function readMeta(message: UIMessage): Record<string, unknown> | undefined {
  const meta = (message as UIMessage & { metadata?: Record<string, unknown> })
    .metadata
  return meta && typeof meta === "object" ? meta : undefined
}

/** 时间线里是否已有针对该组长中断消息的澄清作答（含 approved_at / tool 已 output） */
export function isLeaderClarifyResolvedInTimeline(
  messages: UIMessage[],
  leaderMessageId: string
): boolean {
  for (const msg of messages) {
    if (msg.role !== "assistant") continue
    const meta = readMeta(msg)
    if (!meta) continue
    const target = resolveGroupClarifyTarget(meta)
    if (!target) continue
    if (parseDbMessageId(target.messageId) !== leaderMessageId) continue
    if (typeof meta.approved_at === "string" && meta.approved_at.length > 0) {
      return true
    }
    for (const part of msg.parts ?? []) {
      if (part.type !== CLARIFY_TOOL_TYPE) continue
      if (
        toolPartHasFinalOutput(part as { state?: string; output?: unknown })
      ) {
        return true
      }
    }
  }
  return false
}

/** 群时间线上的澄清投影是否仍待用户作答 */
export function isGroupClarifyProjectionPending(
  message: UIMessage,
  dismissedLeaderMessageIds?: ReadonlySet<string>,
  allMessages?: UIMessage[]
): boolean {
  if (message.role !== "assistant") return false
  const meta = readMeta(message)
  if (!meta) return false
  const target = resolveGroupClarifyTarget(meta)
  if (!target) return false
  if (typeof meta.approved_at === "string" && meta.approved_at.length > 0) {
    return false
  }
  const leaderId = parseDbMessageId(target.messageId)
  if (!leaderId) return false
  if (dismissedLeaderMessageIds?.has(leaderId)) {
    return false
  }
  if (allMessages && isLeaderClarifyResolvedInTimeline(allMessages, leaderId)) {
    return false
  }

  const parts = message.parts
  if (!parts?.length) {
    return false
  }

  let sawClarifyPart = false
  for (const part of parts) {
    if (part.type !== CLARIFY_TOOL_TYPE) continue
    sawClarifyPart = true
    if (
      !toolPartHasFinalOutput(part as { state?: string; output?: unknown })
    ) {
      return true
    }
  }

  return false
}

/** 从群时间线扫描唯一待办澄清（最新一条 pending 投影） */
export function resolveGroupActiveHitlFromTimeline(
  messages: UIMessage[],
  dismissedLeaderMessageIds?: ReadonlySet<string>
): ActiveHitl | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!isGroupClarifyProjectionPending(msg, dismissedLeaderMessageIds, messages)) {
      continue
    }
    const meta = readMeta(msg)
    const target = meta ? resolveGroupClarifyTarget(meta) : null
    if (!target) continue

    const dbMessageId = parseDbMessageId(target.messageId)
    if (!dbMessageId) continue

    const seeded = seedActiveHitlFromMessageParts(dbMessageId, msg.parts)
    if (seeded) {
      return {
        ...seeded,
        conversationIdOverride: target.conversationId,
      }
    }

    const clarifyPart = msg.parts?.find((p) => p.type === CLARIFY_TOOL_TYPE) as
      | { toolCallId?: string; input?: unknown }
      | undefined
    const partInput = extractClarifyInputFromMessageParts(msg.parts)

    return {
      dbMessageId,
      toolCallId: clarifyPart?.toolCallId ?? "",
      kind: "clarify",
      input: partInput,
      conversationIdOverride: target.conversationId,
    }
  }
  return null
}

export function isHitlAlreadyApprovedError(message: string | undefined): boolean {
  if (!message) return false
  return message.includes("已审批")
}
