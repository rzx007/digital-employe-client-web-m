import {
  DESTRUCTIVE_HITL_TOOL_NAMES,
  isDestructiveHitlToolName,
} from "../../hitl/constants"
import {
  buildDestructiveDeletePreview,
  isDestructiveDeletePendingState,
} from "../../destructive-delete-payload"
import type { ToolBlockHandler } from "./plan-generated"

export const destructiveDeleteHandler: ToolBlockHandler = {
  match: (vm) => isDestructiveHitlToolName(vm.toolName),
  classify: (vm, messageId, index) => {
    if (
      vm.state === "output-available" ||
      vm.state === "output-error"
    ) {
      return null
    }

    const preview = buildDestructiveDeletePreview(vm.toolName, vm.input)
    if (!preview && !isDestructiveDeletePendingState(vm.state)) {
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
