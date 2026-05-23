export const CLARIFY_TOOL_NAME = "submit_clarifying_questions"
export const DOCUMENT_PLAN_TOOL_NAME = "submit_document_plan"

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
