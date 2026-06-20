import { EXTERNAL_DIR_TOOL_NAME } from "../../hitl/constants"
import type { ToolBlockHandler } from "./plan-generated"

export const externalDirAuthHandler: ToolBlockHandler = {
  match: (vm) => vm.toolName === EXTERNAL_DIR_TOOL_NAME,
  classify: (vm, messageId, index) => {
    // 已成功确认输出时不渲染卡片（工具已完成）
    if (vm.state === "output-available") {
      return null
    }

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
