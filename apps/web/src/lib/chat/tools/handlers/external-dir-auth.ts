import { EXTERNAL_DIR_TOOL_NAME } from "../../hitl/constants"
import type { ToolBlockHandler } from "./plan-generated"

export const externalDirAuthHandler: ToolBlockHandler = {
  match: (vm) => vm.toolName === EXTERNAL_DIR_TOOL_NAME,
  classify: (vm, messageId, index) => {
    // output-available（已批准）也渲染卡片——卡片走 isConfirmed 分支，
    // 显示「授权已确认」+ 目标路径、无按钮。与 output-error（拒绝）对称。
    return {
      kind: "external_dir_authorization",
      key: `${messageId}:external-dir-auth:${index}`,
      toolCallId: vm.toolCallId,
      toolName: vm.toolName,
      state: vm.state,
      input: vm.input,
      resultText: vm.resultText,
    }
  },
}
