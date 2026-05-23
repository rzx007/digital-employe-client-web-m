import type { UIMessage } from "ai"
import {
  CLARIFY_TOOL_NAME,
  DOCUMENT_PLAN_TOOL_NAME,
} from "./hitl-tool-call-resolve"

const HITL_TOOL_TYPES = new Set([
  `tool-${CLARIFY_TOOL_NAME}`,
  `tool-${DOCUMENT_PLAN_TOOL_NAME}`,
])

export type PendingHitlKind = "clarify" | "document-plan"

export type PendingHitl = {
  kind: PendingHitlKind
  messageId: string
  toolCallId: string
  input: unknown
}

export type HitlPatchOptions = {
  kind?: PendingHitlKind
  toolCallId?: string
  resumed?: boolean
  assistantMessageId?: string | number
}

function kindFromToolType(type: string): PendingHitlKind | null {
  if (type === `tool-${CLARIFY_TOOL_NAME}`) return "clarify"
  if (type === `tool-${DOCUMENT_PLAN_TOOL_NAME}`) return "document-plan"
  return null
}

export function toolPartHasFinalOutput(part: {
  state?: string
  output?: unknown
}): boolean {
  if (part.state === "output-available" || part.state === "output-error") {
    return true
  }
  return Boolean(part.output)
}

function getResolvedHitlToolTypes(parts: UIMessage["parts"]): Set<string> {
  const resolved = new Set<string>()
  for (const part of parts) {
    if (
      HITL_TOOL_TYPES.has(part.type) &&
      toolPartHasFinalOutput(part as { state?: string; output?: unknown })
    ) {
      resolved.add(part.type)
    }
  }
  return resolved
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

function isPendingHitlPart(
  part: UIMessage["parts"][number],
  resolvedTypes: Set<string>,
  resolvedToolCallIds: Set<string>
): boolean {
  if (!HITL_TOOL_TYPES.has(part.type)) return false
  if (resolvedTypes.has(part.type)) return false
  const toolCallId =
    "toolCallId" in part && typeof part.toolCallId === "string"
      ? part.toolCallId
      : ""
  if (toolCallId && resolvedToolCallIds.has(toolCallId)) return false
  const toolPart = part as { state?: string; output?: unknown }
  if (toolPartHasFinalOutput(toolPart)) return false
  const state = toolPart.state
  if (state === "output-available" || state === "output-error") return false
  return (
    state === undefined ||
    state === "input-available" ||
    state === "input-streaming" ||
    state === "call"
  )
}

export function dedupeHitlPartsInMessage(message: UIMessage): UIMessage {
  if (message.role !== "assistant") return message
  const resolvedTypes = getResolvedHitlToolTypes(message.parts)
  if (resolvedTypes.size === 0) return message

  const parts = message.parts.filter((part) => {
    if (!HITL_TOOL_TYPES.has(part.type)) return true
    if (!resolvedTypes.has(part.type)) return true
    return !isPendingHitlPart(
      part,
      resolvedTypes,
      getResolvedHitlToolCallIds(message.parts)
    )
  })
  return { ...message, parts }
}

export function dedupeHitlPartsInMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map(dedupeHitlPartsInMessage)
}

/** POST /approve 使用的 message_id（与 session.hitlMessageId 对齐） */
export function resolveHitlApproveMessageId(
  message: UIMessage,
  sessionHitlMessageId: string | null | undefined
): string {
  if (
    sessionHitlMessageId &&
    String(message.id) === String(sessionHitlMessageId)
  ) {
    return String(sessionHitlMessageId)
  }
  return message.id
}

export function findPendingHitl(messages: UIMessage[]): PendingHitl | null {
  const resolvedTypes = new Set<string>()
  for (const m of messages) {
    if (m.role !== "assistant") continue
    for (const t of getResolvedHitlToolTypes(m.parts)) {
      resolvedTypes.add(t)
    }
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== "assistant") continue
    const resolvedIds = getResolvedHitlToolCallIds(m.parts)
    for (let j = m.parts.length - 1; j >= 0; j--) {
      const part = m.parts[j]
      if (!HITL_TOOL_TYPES.has(part.type)) continue
      if (resolvedTypes.has(part.type)) continue
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

export function isHitlAbortedOutput(resultText?: string | null): boolean {
  if (!resultText) return false
  return (
    resultText.includes("已中止") ||
    resultText.includes("已跳过") ||
    resultText.includes("已取消")
  )
}
