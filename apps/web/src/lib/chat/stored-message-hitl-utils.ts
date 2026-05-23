import type { UIMessage } from "ai"

import type { Message } from "@/lib/mock-data/messages"
import type { HitlPayload } from "@/lib/chat/conversation-runtime-types"
import {
  CLARIFY_TOOL_NAME,
  DOCUMENT_PLAN_TOOL_NAME,
} from "@/lib/chat/hitl-tool-call-resolve"
import { toolPartHasFinalOutput } from "@/lib/chat/hitl-abort-message-utils"

const HITL_TOOL_NAMES = new Set([CLARIFY_TOOL_NAME, DOCUMENT_PLAN_TOOL_NAME])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object"
}

function parseHitlPayload(raw: unknown): HitlPayload | null {
  if (!isRecord(raw)) return null
  const actionRequests = raw.action_requests
  if (!Array.isArray(actionRequests) || actionRequests.length === 0) {
    return null
  }
  const action_requests = actionRequests.flatMap((item) => {
    if (!isRecord(item)) return []
    const name = typeof item.name === "string" ? item.name : ""
    if (!name || !HITL_TOOL_NAMES.has(name)) return []
    const args = isRecord(item.args) ? item.args : {}
    return [{ name, args }]
  })
  if (action_requests.length === 0) return null
  return {
    action_requests,
    review_configs: Array.isArray(raw.review_configs)
      ? raw.review_configs
      : [],
  }
}

export function extractInterruptStateFromMessage(message: Message): {
  hitlPayload: HitlPayload
  streamId: string | null
} | null {
  if (message.role !== "assistant" || message.streamState !== "interrupted") {
    return null
  }
  const meta = message.metadata
  if (!isRecord(meta)) return null

  const hitlPayload = parseHitlPayload(meta.interrupt_payload)
  if (!hitlPayload) return null

  const streamId =
    typeof meta.stream_id === "string" && meta.stream_id.length > 0
      ? meta.stream_id
      : null

  return { hitlPayload, streamId }
}

export function extractInterruptStateFromStoredMessages(
  messages: Message[]
): { hitlPayload: HitlPayload; streamId: string | null } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue
    return extractInterruptStateFromMessage(msg)
  }
  return null
}

function synthesizePendingHitlPart(
  action: { name: string; args: Record<string, unknown> },
  toolCallId: string
): UIMessage["parts"][number] {
  return {
    type: `tool-${action.name}`,
    toolCallId,
    state: "input-available",
    input: action.args,
  } as UIMessage["parts"][number]
}

function hasPendingHitlToolPart(
  parts: UIMessage["parts"],
  toolName: string
): boolean {
  const toolType = `tool-${toolName}`
  return parts.some((part) => {
    if (part.type !== toolType) return false
    return !toolPartHasFinalOutput(part as { state?: string; output?: unknown })
  })
}

/**
 * 将 extra_meta.interrupt_payload 合成进 assistant parts，供刷新后渲染 DocumentPlanCard 等。
 */
export function enrichAssistantPartsFromStoredMessage(
  message: Message,
  parts: UIMessage["parts"]
): UIMessage["parts"] {
  const interrupt = extractInterruptStateFromMessage(message)
  if (!interrupt) return parts

  const action = interrupt.hitlPayload.action_requests[0]
  if (!action) return parts
  if (hasPendingHitlToolPart(parts, action.name)) return parts

  const toolCallId =
    typeof interrupt.streamId === "string" && interrupt.streamId.length > 0
      ? `hitl-${interrupt.streamId.slice(0, 8)}`
      : `hitl-pending-${action.name}`

  const pendingPart = synthesizePendingHitlPart(action, toolCallId)
  return [...parts, pendingPart]
}
