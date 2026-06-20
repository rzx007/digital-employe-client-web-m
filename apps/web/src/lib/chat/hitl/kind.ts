import {
  CLARIFY_TOOL_NAME,
  DOCUMENT_PLAN_TOOL_NAME,
  BUG_REPORT_TOOL_NAME,
  EXTERNAL_DIR_TOOL_NAME,
  isDestructiveHitlToolName,
} from "./constants"

export type PendingHitlKind =
  | "clarify"
  | "document-plan"
  | "bug-report"
  | "destructive-delete"
  | "external_dir_authorization"

/**
 * 单一来源：把 UIMessage part 的 `type`（形如 `tool-<name>`）映射为 HITL kind。
 *
 * 收敛前此逻辑在 `pending.ts`（kindFromToolType）与 `active-hitl.ts`（kindFromPartType）
 * 各有一份完全相同的实现，改一处忘另一处会导致判定不一致。
 * 行为与原两份逐字一致：仅当带 `tool-` 前缀时匹配 clarify / document-plan。
 */
export function hitlKindFromToolType(type: string): PendingHitlKind | null {
  if (type === `tool-${CLARIFY_TOOL_NAME}`) return "clarify"
  if (type === `tool-${DOCUMENT_PLAN_TOOL_NAME}`) return "document-plan"
  if (type === `tool-${BUG_REPORT_TOOL_NAME}`) return "bug-report"
  if (type === `tool-${EXTERNAL_DIR_TOOL_NAME}`) return "external_dir_authorization"
  const toolName = type.startsWith("tool-") ? type.slice("tool-".length) : ""
  if (isDestructiveHitlToolName(toolName)) return "destructive-delete"
  return null
}
