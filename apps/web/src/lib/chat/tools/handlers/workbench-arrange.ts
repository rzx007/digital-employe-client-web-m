import type { WorkbenchArrangeOp } from "@/types/workbench"
import type { ToolBlockHandler } from "./plan-generated"

const MARKER = "WORKBENCH_ARRANGE_V1"

/** 从工具回吐文本里解析出 operations 数组；无 marker / 解析失败返回 null。 */
export function parseArrangeResult(
  resultText: string | null | undefined
): WorkbenchArrangeOp[] | null {
  const markerAt = resultText ? resultText.indexOf(MARKER) : -1
  if (markerAt < 0) return null
  // 锚定到 marker，再回退到它前面最近的 '{'（即 payload 对象的左括号）。
  // 不能用第一个 '{'：摘要里被忽略的错误可能含 Python repr 的花括号（如 span 非法 {'w':...}），
  // 那样会把起点定到摘要里的假括号，导致整段 JSON 解析失败、看板卡静默消失。
  const start = resultText.lastIndexOf("{", markerAt)
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
