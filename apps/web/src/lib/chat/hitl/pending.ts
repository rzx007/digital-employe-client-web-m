import type { UIMessage } from "ai"

import {
  CLARIFY_TOOL_NAME,
  DOCUMENT_PLAN_TOOL_NAME,
  isDestructiveHitlToolName,
  HITL_TOOL_TYPES,
} from "./constants"
import { toolPartHasFinalOutput } from "./part-utils"

export type PendingHitlKind = "clarify" | "document-plan" | "destructive-delete"

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
  approvedMessageId?: string | number
  resumed?: boolean
  assistantMessageId?: string | number
}

function kindFromToolType(type: string): PendingHitlKind | null {
  if (type === `tool-${CLARIFY_TOOL_NAME}`) return "clarify"
  if (type === `tool-${DOCUMENT_PLAN_TOOL_NAME}`) return "document-plan"
  const toolName = type.startsWith("tool-") ? type.slice("tool-".length) : ""
  if (isDestructiveHitlToolName(toolName)) return "destructive-delete"
  return null
}

function getResolvedHitlToolCallIds(parts: UIMessage["parts"]): Set<string> {
  const resolved = new Set<string>()
  for (const part of parts) {
    if (!HITL_TOOL_TYPES.has(part.type)) continue
    if (!toolPartHasFinalOutput(part as { state?: string; output?: unknown })) {
      continue
    }
    const toolCallId =
      "toolCallId" in part && typeof part.toolCallId === "string"
        ? part.toolCallId
        : ""
    if (toolCallId) resolved.add(toolCallId)
  }
  return resolved
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
      const kind = kindFromToolType(part.type)
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
