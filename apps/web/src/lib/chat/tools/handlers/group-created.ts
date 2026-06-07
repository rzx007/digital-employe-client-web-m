import { resolveGroupCreatedBlockKind } from "../../group-created-tool-payload"
import type { ToolBlockHandler } from "./plan-generated"

export const groupCreatedHandler: ToolBlockHandler = {
  match: (vm) => vm.toolName === "create_group_and_dispatch",
  classify: (vm, messageId, index) => {
    const blockKind = resolveGroupCreatedBlockKind(
      vm.toolName,
      vm.state,
      vm.resultText,
      vm.preliminary
    )
    if (!blockKind) return null

    return {
      kind: blockKind,
      key: `${messageId}:group-created:${index}`,
      toolCallId: vm.toolCallId,
      state: vm.state,
      resultText: vm.resultText,
      preliminary: vm.preliminary,
    }
  },
}
