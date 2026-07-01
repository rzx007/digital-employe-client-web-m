import { DOCUMENT_PLAN_TOOL_NAME, isHitlAbortedOutput } from "../../hitl"
import type { ToolBlockHandler } from "./plan-generated"

function hasDocumentPlanCardInput(input: unknown): boolean {
  if (!input || typeof input !== "object") return false
  const record = input as Record<string, unknown>
  const title = typeof record.title === "string" ? record.title.trim() : ""
  const outline =
    typeof record.outline === "string" ? record.outline.trim() : ""
  return Boolean(title || outline)
}

export const documentPlanHandler: ToolBlockHandler = {
  match: (vm) => vm.toolName === DOCUMENT_PLAN_TOOL_NAME,
  classify: (vm, messageId, index) => {
    const docResultText = vm.resultText
    const docToolState = vm.state
    const hasPlanInput = hasDocumentPlanCardInput(vm.input)
    const hasPlanOutput =
      docToolState === "output-available" ||
      docToolState === "output-error" ||
      Boolean(docResultText?.trim())

    if (isHitlAbortedOutput(docResultText)) {
      return {
        kind: "document-plan",
        key: `${messageId}:doc-plan:${index}`,
        toolCallId: vm.toolCallId,
        input: vm.input,
        state: "output-available",
        resultText: docResultText,
      }
    }

    if (hasPlanOutput && !hasPlanInput && docResultText?.trim()) {
      return {
        kind: "document-plan-approved",
        key: `${messageId}:doc-plan-approved:${index}`,
        toolCallId: vm.toolCallId,
        resultText: docResultText.trim(),
      }
    }

    return {
      kind: "document-plan",
      key: `${messageId}:doc-plan:${index}`,
      toolCallId: vm.toolCallId,
      input: vm.input,
      state: docToolState,
      resultText: docResultText,
    }
  },
}
