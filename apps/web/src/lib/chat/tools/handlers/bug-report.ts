import { BUG_REPORT_TOOL_NAME } from "../../hitl/constants"
import type { ToolBlockHandler } from "./plan-generated"

export const bugReportHandler: ToolBlockHandler = {
  match: (vm) => vm.toolName === BUG_REPORT_TOOL_NAME,
  classify: (vm, messageId, index) => {
    return {
      kind: "bug-report",
      key: `${messageId}:bug-report:${index}`,
      toolCallId: vm.toolCallId,
      input: vm.input,
      state: vm.state,
      resultText: vm.resultText,
    }
  },
}
