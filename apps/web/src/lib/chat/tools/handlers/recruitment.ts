import {
  isRecruitmentToolRunning,
  parseEmployeeHiredPayload,
  parseRecruitmentCandidatesPayload,
} from "../../recruitment-tool-payload"
import type { ToolBlockHandler } from "./plan-generated"

export const recruitmentHandler: ToolBlockHandler = {
  match: (vm) =>
    vm.toolName === "recruit_employee" ||
    vm.toolName === "hire_employee" ||
    vm.toolName === "hire_employees",
  classify: (vm, messageId, index) => {
    const toolState = vm.state
    const toolResultText = vm.resultText

    if (vm.toolName === "recruit_employee") {
      const payload = parseRecruitmentCandidatesPayload(toolResultText)
      if (payload || isRecruitmentToolRunning(toolState)) {
        return {
          kind: "recruitment-candidates",
          key: `${messageId}:recruit:${index}`,
          toolCallId: vm.toolCallId,
          state: toolState,
          resultText: toolResultText,
        }
      }
    }

    if (vm.toolName === "hire_employee") {
      const payload = parseEmployeeHiredPayload(toolResultText)
      if (payload || isRecruitmentToolRunning(toolState)) {
        return {
          kind: "employee-hired",
          key: `${messageId}:hire:${index}`,
          toolCallId: vm.toolCallId,
          state: toolState,
          resultText: toolResultText,
        }
      }
    }

    return null
  },
}
