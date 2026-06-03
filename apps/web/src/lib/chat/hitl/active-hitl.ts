import type { UIMessage } from "ai"

import {
  CLARIFY_TOOL_NAME,
  DOCUMENT_PLAN_TOOL_NAME,
  HITL_TOOL_NAMES,
  isDestructiveHitlToolName,
} from "./constants"
import {
  findHitlToolCallIdInParts,
  parseDbMessageId,
  type DbMessageId,
} from "./message-id"
import type { PendingHitlKind } from "./pending"
import { findPendingHitl } from "./pending"

/** POST /approve 唯一真相：来自 interrupt SSE（或冷启动 DB seed），与 UIMessage.id 无关 */
export type ActiveHitl = {
  dbMessageId: DbMessageId
  toolCallId: string
  kind: PendingHitlKind
  input?: unknown
}

type StoredHitlPart = {
  type?: string
  toolCallId?: string
  state?: string
  input?: unknown
}

function kindFromPartType(type: string): PendingHitlKind | null {
  if (type === `tool-${CLARIFY_TOOL_NAME}`) return "clarify"
  if (type === `tool-${DOCUMENT_PLAN_TOOL_NAME}`) return "document-plan"
  const toolName = type.startsWith("tool-") ? type.slice("tool-".length) : ""
  if (isDestructiveHitlToolName(toolName)) return "destructive-delete"
  return null
}

function hitlPartFromMessageParts(
  messageParts: unknown
): StoredHitlPart | null {
  if (!Array.isArray(messageParts)) return null
  for (const raw of messageParts) {
    if (!raw || typeof raw !== "object") continue
    const part = raw as StoredHitlPart
    if (typeof part.type !== "string" || !part.type.startsWith("tool-")) {
      continue
    }
    const toolName = part.type.slice("tool-".length)
    if (!HITL_TOOL_NAMES.has(toolName)) continue
    if (part.state !== "input-available") continue
    if (!part.toolCallId) continue
    return part
  }
  return null
}

export function buildActiveHitlFromInterruptPayload(payload: {
  message_id?: string | number | null
  message_parts?: unknown
}): ActiveHitl | null {
  const dbMessageId = parseDbMessageId(payload.message_id)
  if (!dbMessageId) return null

  const part = hitlPartFromMessageParts(payload.message_parts)
  if (!part?.toolCallId || typeof part.type !== "string") return null

  const kind = kindFromPartType(part.type)
  if (!kind) return null

  return {
    dbMessageId,
    toolCallId: part.toolCallId,
    kind,
    input: part.input,
  }
}

/** interrupt 仅有 message_id、parts 尚未进 composer 时，与 findPendingHitl 对齐 */
export function resolveActiveHitl(
  payload: {
    message_id?: string | number | null
    message_parts?: unknown
  },
  composerMessages: UIMessage[]
): ActiveHitl | null {
  const direct = buildActiveHitlFromInterruptPayload(payload)
  if (direct) return direct

  const dbMessageId = parseDbMessageId(payload.message_id)
  if (!dbMessageId) return null

  const pending = findPendingHitl(composerMessages)
  if (!pending || pending.toolCallId.length === 0) return null

  return {
    dbMessageId,
    toolCallId: pending.toolCallId,
    kind: pending.kind,
    input: pending.input,
  }
}

/** F5 / 切会话 hydrate：从 DB 行恢复 interrupted 待办 */
export function seedActiveHitlFromMessageParts(
  dbMessageId: DbMessageId,
  messageParts: unknown
): ActiveHitl | null {
  const part = hitlPartFromMessageParts(messageParts)
  if (!part?.toolCallId || typeof part.type !== "string") return null
  const kind = kindFromPartType(part.type)
  if (!kind) return null
  return {
    dbMessageId,
    toolCallId: part.toolCallId,
    kind,
    input: part.input,
  }
}

export function activeHitlMatchesPending(
  active: ActiveHitl | null,
  toolCallId: string | undefined
): boolean {
  if (!active || !toolCallId) return false
  return active.toolCallId === toolCallId
}

export { findHitlToolCallIdInParts }
