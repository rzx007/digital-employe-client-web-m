import { resolveTasksDeletedBlockKind } from "../../task-deleted-tool-payload"
import { isDestructiveDeleteRejected } from "../../hitl/aborted-output"
import type { ToolBlockHandler } from "./plan-generated"

export const taskMutationsHandler: ToolBlockHandler = {
  match: (vm) => vm.toolName === "delete_tasks_batch",
  classify: (vm, messageId, index) => {
    if (
      vm.state === "output-error" &&
      isDestructiveDeleteRejected(vm.resultText)
    ) {
      return null
    }

    const blockKind = resolveTasksDeletedBlockKind(
      vm.toolName,
      vm.state,
      vm.resultText,
      vm.preliminary
    )
    if (!blockKind) return null

    return {
      kind: blockKind,
      key: `${messageId}:tasks-deleted:${index}`,
      toolCallId: vm.toolCallId,
      state: vm.state,
      resultText: vm.resultText,
      preliminary: vm.preliminary,
    }
  },
}
