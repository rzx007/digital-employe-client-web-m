export const CLARIFY_TOOL_NAME = "submit_clarifying_questions"
export const DOCUMENT_PLAN_TOOL_NAME = "submit_document_plan"

export const HITL_TOOL_NAMES = new Set([
  CLARIFY_TOOL_NAME,
  DOCUMENT_PLAN_TOOL_NAME,
])

export const HITL_TOOL_TYPES = new Set([
  `tool-${CLARIFY_TOOL_NAME}`,
  `tool-${DOCUMENT_PLAN_TOOL_NAME}`,
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
