import { resolveRecruitmentToolBlockKind } from "../../recruitment-tool-payload"
import type { ToolBlockHandler } from "./plan-generated"

export const recruitmentHandler: ToolBlockHandler = {
  match: (vm) =>
    vm.toolName === "recruit_employee" ||
    vm.toolName === "hire_employee" ||
    vm.toolName === "hire_employees",
  classify: (vm, messageId, index) => {
    const blockKind = resolveRecruitmentToolBlockKind(
      vm.toolName,
      vm.state,
      vm.resultText,
      vm.preliminary
    )
    if (!blockKind) return null

    const keySuffix =
      blockKind === "recruitment-candidates"
        ? "recruit"
        : blockKind === "employees-hired"
          ? "hire-batch"
          : "hire"

    return {
      kind: blockKind,
      key: `${messageId}:${keySuffix}:${index}`,
      toolCallId: vm.toolCallId,
      state: vm.state,
      resultText: vm.resultText,
      preliminary: vm.preliminary,
    }
  },
}
