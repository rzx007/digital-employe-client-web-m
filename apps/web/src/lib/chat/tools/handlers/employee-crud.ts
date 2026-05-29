import { resolveEmployeeCrudBlockKind } from "../../employee-crud-tool-payload"
import { isDestructiveDeleteRejected } from "../../hitl/aborted-output"
import type { ToolBlockHandler } from "./plan-generated"

export const employeeCrudHandler: ToolBlockHandler = {
  match: (vm) =>
    vm.toolName === "get_employee" ||
    vm.toolName === "update_employee" ||
    vm.toolName === "delete_employee",
  classify: (vm, messageId, index) => {
    if (
      vm.toolName === "delete_employee" &&
      vm.state === "output-error" &&
      isDestructiveDeleteRejected(vm.resultText)
    ) {
      return null
    }

    const blockKind = resolveEmployeeCrudBlockKind(
      vm.toolName,
      vm.state,
      vm.resultText
    )
    if (!blockKind) return null

    const keySuffix =
      blockKind === "employee-detail"
        ? "detail"
        : blockKind === "employee-updated"
          ? "updated"
          : "deleted"

    return {
      kind: blockKind,
      key: `${messageId}:employee-${keySuffix}:${index}`,
      toolCallId: vm.toolCallId,
      state: vm.state,
      resultText: vm.resultText,
    }
  },
}
