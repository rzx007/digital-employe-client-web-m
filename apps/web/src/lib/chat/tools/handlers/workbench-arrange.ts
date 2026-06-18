import type { WorkbenchArrangeOp } from "@/types/workbench"
import type { ToolBlockHandler } from "./plan-generated"

const MARKER = "WORKBENCH_ARRANGE_V1"

/** 从工具回吐文本里解析出 operations 数组；无 marker / 解析失败返回 null。 */
export function parseArrangeResult(
  resultText: string | null | undefined
): WorkbenchArrangeOp[] | null {
  if (!resultText || !resultText.includes(MARKER)) return null
  // marker JSON 在文本里独占一段，找到第一个 '{' 起的 JSON。
  const start = resultText.indexOf("{")
  if (start < 0) return null
  try {
    const parsed = JSON.parse(resultText.slice(start))
    if (parsed?.marker !== MARKER || !Array.isArray(parsed.operations)) return null
    return parsed.operations as WorkbenchArrangeOp[]
  } catch {
    return null
  }
}

export const workbenchArrangeHandler: ToolBlockHandler = {
  match: (vm) => vm.toolName === "arrange_workbench",
  classify: (vm, messageId, index) => {
    const operations = parseArrangeResult(vm.resultText)
    if (!operations) return null
    const summary = (vm.resultText ?? "").split("\n")[0] ?? "工作台已更新"
    return {
      kind: "workbench-arrange",
      key: `${messageId}:workbench-arrange:${index}`,
      toolCallId: vm.toolCallId,
      operations,
      summary,
    }
  },
}
