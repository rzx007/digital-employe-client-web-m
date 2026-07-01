import {
  isDestructiveHitlToolName,
} from "../../hitl/constants"
import { isDestructiveDeleteRejected } from "../../hitl/aborted-output"
import {
  buildDestructiveDeletePreview,
  isDestructiveDeletePendingState,
} from "../../destructive-delete-payload"
import type { ToolBlockHandler } from "./plan-generated"

export const destructiveDeleteHandler: ToolBlockHandler = {
  match: (vm) => isDestructiveHitlToolName(vm.toolName),
  classify: (vm, messageId, index) => {
    const userRejected =
      vm.state === "output-error" && isDestructiveDeleteRejected(vm.resultText)

    if (vm.state === "output-available") {
      return null
    }
    if (vm.state === "output-error" && !userRejected) {
      return null
    }

    const preview = buildDestructiveDeletePreview(vm.toolName, vm.input)
    if (!preview && !isDestructiveDeletePendingState(vm.state) && !userRejected) {
      return null
    }

    return {
      kind: "destructive-delete",
      key: `${messageId}:destructive-delete:${index}`,
      toolCallId: vm.toolCallId,
      toolName: vm.toolName,
      state: vm.state,
      input: vm.input,
      resultText: vm.resultText,
    }
  },
}
