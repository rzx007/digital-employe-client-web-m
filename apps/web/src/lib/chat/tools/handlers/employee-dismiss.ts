import { resolveEmployeesDismissedBlockKind } from "../../employee-dismissed-tool-payload"
import { isDestructiveDeleteRejected } from "../../hitl/aborted-output"
import type { ToolBlockHandler } from "./plan-generated"

export const employeeDismissHandler: ToolBlockHandler = {
  match: (vm) => vm.toolName === "delete_employees_batch",
  classify: (vm, messageId, index) => {
    if (
      vm.state === "output-error" &&
      isDestructiveDeleteRejected(vm.resultText)
    ) {
      return null
    }

    const blockKind = resolveEmployeesDismissedBlockKind(
      vm.toolName,
      vm.state,
      vm.resultText,
      vm.preliminary
    )
    if (!blockKind) return null

    return {
      kind: blockKind,
      key: `${messageId}:employees-dismissed:${index}`,
      toolCallId: vm.toolCallId,
      state: vm.state,
      resultText: vm.resultText,
      preliminary: vm.preliminary,
    }
  },
}
