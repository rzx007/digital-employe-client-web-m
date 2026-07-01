import type { UIMessage } from "ai"

import type { ActiveHitl } from "./active-hitl"
import {
  assistantMessageHasToolCallId,
  getApproveMessageIdFromMeta,
  parseDbMessageId,
} from "./message-id"

/**
 * 气泡内 HITL 卡审批 id：优先 metadata / DB id，ActiveHitl 作兜底。
 */
export function resolveHitlApproveMessageId(
  message: UIMessage,
  activeHitl: ActiveHitl | null | undefined
): string | null {
  const meta = (message as UIMessage & { metadata?: Record<string, unknown> })
    .metadata

  if (
    activeHitl?.dbMessageId &&
    activeHitl.toolCallId &&
    assistantMessageHasToolCallId(message, activeHitl.toolCallId)
  ) {
    return activeHitl.dbMessageId
  }

  const fromMeta = getApproveMessageIdFromMeta(meta)
  if (fromMeta) return fromMeta

  const anchorId = parseDbMessageId(meta?.hitlAnchorMessageId)
  if (anchorId) return anchorId

  const dbRowId = parseDbMessageId(message.id)
  if (dbRowId) return dbRowId

  if (activeHitl?.dbMessageId) return activeHitl.dbMessageId

  return null
}
