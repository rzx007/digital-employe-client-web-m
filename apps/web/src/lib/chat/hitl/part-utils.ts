import type { UIMessage } from "ai"

import { HITL_TOOL_TYPES } from "./constants"

export function toolPartHasFinalOutput(part: {
  state?: string
  output?: unknown
}): boolean {
  if (part.state === "output-available" || part.state === "output-error") {
    return true
  }
  return Boolean(part.output)
}

/**
 * 单一来源：一条 assistant 消息内，已拿到最终 output 的 HITL toolCallId 集合。
 *
 * 收敛前 `pending.ts` 与 `parts-dedupe.ts` 各有一份完全相同的实现。
 */
export function getResolvedHitlToolCallIds(
  parts: UIMessage["parts"]
): Set<string> {
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
