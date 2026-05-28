import type { ClassifiedBlock } from "../message-classifier"
import type { ToolViewModel } from "./tool-view-model"

export interface ToolBlockHandler {
  match: (vm: ToolViewModel) => boolean
  classify: (
    vm: ToolViewModel,
    messageId: string,
    partIndex: number
  ) => ClassifiedBlock | ClassifiedBlock[] | null
}

export const planGeneratedHandler: ToolBlockHandler = {
  match: (vm) => vm.toolName === "create_orchestration_plan",
  classify: (vm, messageId, index) => {
    return {
      kind: "plan-generated",
      key: `${messageId}:plan:${index}`,
      toolCallId: vm.toolCallId,
      input: vm.input,
      state: vm.state,
    }
  },
}
