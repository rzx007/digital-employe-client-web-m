import type { UIMessage } from "ai"

import { HITL_TOOL_TYPES } from "./constants"
import { toolPartHasFinalOutput } from "./part-utils"

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
  if (toolCallId && resolvedToolCallIds.has(toolCallId)) return true
  if (resolvedTypes.has(part.type)) return true
  return false
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
