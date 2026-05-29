import { resolveTasksDeletedBlockKind } from "../../task-deleted-tool-payload"
import type { ToolBlockHandler } from "./plan-generated"

export const taskMutationsHandler: ToolBlockHandler = {
  match: (vm) => vm.toolName === "delete_tasks_batch",
  classify: (vm, messageId, index) => {
    const blockKind = resolveTasksDeletedBlockKind(
      vm.toolName,
      vm.state,
      vm.resultText
    )
    if (!blockKind) return null

    return {
      kind: blockKind,
      key: `${messageId}:tasks-deleted:${index}`,
      toolCallId: vm.toolCallId,
      state: vm.state,
      resultText: vm.resultText,
    }
  },
}
