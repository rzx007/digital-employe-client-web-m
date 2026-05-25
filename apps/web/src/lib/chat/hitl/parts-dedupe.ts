import type { UIMessage } from "ai"

import { HITL_TOOL_TYPES } from "./constants"
import { toolPartHasFinalOutput } from "./part-utils"

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

/** 同一条 assistant 消息内，已有 output 的 toolCallId 对应的 pending part 视为陈旧副本 */
function isStalePendingHitlPart(
  part: UIMessage["parts"][number],
  resolvedToolCallIds: Set<string>
): boolean {
  if (!HITL_TOOL_TYPES.has(part.type)) return false

  const toolPart = part as { state?: string; output?: unknown }
  if (toolPartHasFinalOutput(toolPart)) return false

  const state = toolPart.state
  if (state === "output-available" || state === "output-error") return false

  const isPendingState =
    state === undefined ||
    state === "input-available" ||
    state === "input-streaming" ||
    state === "call"
  if (!isPendingState) return false

  const toolCallId =
    "toolCallId" in part && typeof part.toolCallId === "string"
      ? part.toolCallId
      : ""
  return Boolean(toolCallId && resolvedToolCallIds.has(toolCallId))
}

export function dedupeHitlPartsInMessage(message: UIMessage): UIMessage {
  if (message.role !== "assistant") return message
  const resolvedToolCallIds = getResolvedHitlToolCallIds(message.parts)
  if (resolvedToolCallIds.size === 0) return message

  const parts = message.parts.filter(
    (part) => !isStalePendingHitlPart(part, resolvedToolCallIds)
  )
  return { ...message, parts }
}

export function dedupeHitlPartsInMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map(dedupeHitlPartsInMessage)
}
