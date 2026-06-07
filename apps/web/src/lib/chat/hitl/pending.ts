import type { UIMessage } from "ai"

import { HITL_TOOL_TYPES } from "./constants"
import {
  getResolvedHitlToolCallIds,
  toolPartHasFinalOutput,
} from "./part-utils"
import { hitlKindFromToolType, type PendingHitlKind } from "./kind"
import type { DbMessageId } from "./message-id"

export type { PendingHitlKind } from "./kind"

/** composer 上扫描到的 pending tool（题目 input 等）；审批 id 见 ActiveHitl */
export type PendingHitl = {
  kind: PendingHitlKind
  messageId: string
  toolCallId: string
  input: unknown
}

export type HitlPatchOptions = {
  kind?: PendingHitlKind
  toolCallId?: string
  /** 已审批并封存的 assistant 行（POST /approve 的 message_id） */
  approvedMessageId?: DbMessageId
  resumed?: boolean
  assistantMessageId?: string | number
  /**
   * 群澄清等：approve 打在组长私有会话，续流由后端完成。
   * 勿向群 composer 塞空 assistant、勿对群会话 resumeStream。
   */
  skipLocalResume?: boolean
}

function messageIsApproved(message: UIMessage): boolean {
  const meta = (message as UIMessage & { metadata?: Record<string, unknown> })
    .metadata
  return typeof meta?.approved_at === "string" && meta.approved_at.length > 0
}

export function isHitlComposerBlocked(messages: UIMessage[]): boolean {
  return findPendingHitl(messages) !== null
}

export function findPendingHitl(messages: UIMessage[]): PendingHitl | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== "assistant") continue
    if (messageIsApproved(m)) continue
    const resolvedIds = getResolvedHitlToolCallIds(m.parts)
    for (let j = m.parts.length - 1; j >= 0; j--) {
      const part = m.parts[j]
      if (!HITL_TOOL_TYPES.has(part.type)) continue
      const toolCallId =
        "toolCallId" in part && typeof part.toolCallId === "string"
          ? part.toolCallId
          : ""
      if (toolCallId && resolvedIds.has(toolCallId)) continue
      if (toolPartHasFinalOutput(part as { state?: string; output?: unknown }))
        continue
      const kind = hitlKindFromToolType(part.type)
      if (!kind) continue
      return {
        kind,
        messageId: m.id,
        toolCallId,
        input: "input" in part ? (part as { input: unknown }).input : undefined,
      }
    }
  }
  return null
}
