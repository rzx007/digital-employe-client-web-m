import type { UIMessage } from "ai"

import type { ActiveHitl } from "./active-hitl"
import { parseDbMessageId } from "./message-id"

/**
 * 气泡内方案卡等展示层：审批 id 以 ActiveHitl 为准，merge 气泡仅作对齐辅助。
 */
export function resolveHitlApproveMessageId(
  message: UIMessage,
  activeHitl: ActiveHitl | null | undefined
): string | null {
  if (activeHitl?.dbMessageId) return activeHitl.dbMessageId

  const dbRowId = parseDbMessageId(message.id)
  if (dbRowId) return dbRowId

  return null
}
