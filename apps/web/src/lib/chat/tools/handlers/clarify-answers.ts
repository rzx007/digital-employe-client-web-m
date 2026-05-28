import { CLARIFY_TOOL_NAME, buildClarifyAnswerItems, parseClarifyingQuestions } from "../../hitl"
import type { ToolBlockHandler } from "./plan-generated"

export const clarifyAnswersHandler: ToolBlockHandler = {
  match: (vm) => vm.toolName === CLARIFY_TOOL_NAME,
  classify: (vm, messageId, index) => {
    const toolState = vm.state
    const clarifyResultText = vm.resultText
    const isAnswered =
      toolState === "output-available" || Boolean(clarifyResultText)
    if (!isAnswered) {
      return []
    }
    if (toolState === "output-error") {
      return {
        kind: "clarifying-answers",
        key: `${messageId}:clarify-answers-error:${index}`,
        toolCallId: vm.toolCallId,
        items: [],
        outputError: true,
      }
    }
    const questions = parseClarifyingQuestions(
      typeof vm.input === "object" && vm.input
        ? (vm.input as Record<string, unknown>).questions
        : null
    )
    const items = buildClarifyAnswerItems(questions, clarifyResultText)
    if (items.length === 0) return []
    return {
      kind: "clarifying-answers",
      key: `${messageId}:clarify-answers:${index}`,
      toolCallId: vm.toolCallId,
      items,
    }
  },
}
