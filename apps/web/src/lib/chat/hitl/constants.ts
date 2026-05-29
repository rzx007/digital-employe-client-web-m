export const DESTRUCTIVE_HITL_TOOL_NAMES = new Set([
  "delete_employee",
  "delete_task",
  "delete_tasks_batch",
])

/** 与 DestructiveDeleteConfirmCard reject 文案一致 */
export const DESTRUCTIVE_DELETE_REJECT_MESSAGE = "用户取消删除"

export const CLARIFY_TOOL_NAME = "submit_clarifying_questions"
export const DOCUMENT_PLAN_TOOL_NAME = "submit_document_plan"

export const HITL_TOOL_NAMES = new Set([
  CLARIFY_TOOL_NAME,
  DOCUMENT_PLAN_TOOL_NAME,
  ...DESTRUCTIVE_HITL_TOOL_NAMES,
])

export const HITL_TOOL_TYPES = new Set([
  `tool-${CLARIFY_TOOL_NAME}`,
  `tool-${DOCUMENT_PLAN_TOOL_NAME}`,
  ...Array.from(DESTRUCTIVE_HITL_TOOL_NAMES).map((name) => `tool-${name}`),
])

export function findLastToolCallIdByName(
  toolNamesById: Map<string, string>,
  toolName: string
): string | null {
  let last: string | null = null
  for (const [callId, name] of toolNamesById) {
    if (name === toolName) {
      last = callId
    }
  }
  return last
}

export function isDestructiveHitlToolName(toolName: string): boolean {
  return DESTRUCTIVE_HITL_TOOL_NAMES.has(toolName)
}
