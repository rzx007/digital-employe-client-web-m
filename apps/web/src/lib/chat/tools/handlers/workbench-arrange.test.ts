import { describe, it, expect } from "vitest"
import { workbenchArrangeHandler, parseArrangeResult } from "./workbench-arrange"

describe("workbenchArrangeHandler", () => {
  it("匹配 arrange_workbench 工具", () => {
    expect(
      workbenchArrangeHandler.match({ toolName: "arrange_workbench" } as any)
    ).toBe(true)
    expect(workbenchArrangeHandler.match({ toolName: "list_tasks" } as any)).toBe(
      false
    )
  })

  it("从回吐结果里解析出 operations", () => {
    const resultText =
      '已下发 1 条工作台编排指令。\n{"marker":"WORKBENCH_ARRANGE_V1","operations":[{"op":"pin","resourcePath":"/artifacts/a.html","title":"A"}]}'
    const ops = parseArrangeResult(resultText)
    expect(ops).toEqual([
      { op: "pin", resourcePath: "/artifacts/a.html", title: "A" },
    ])
  })

  it("无 marker 时返回 null", () => {
    expect(parseArrangeResult("普通文本")).toBeNull()
  })

  it("摘要含花括号（被忽略错误的 repr）时仍能定位到真正的 payload", () => {
    // 部分成功：1 条有效 + 1 条被拒，错误文本含 Python repr 花括号
    const resultText =
      "已下发 1 条工作台编排指令。（1 条被忽略：operations[1]：span 非法 {'w': 'x'}）\n" +
      '{"marker":"WORKBENCH_ARRANGE_V1","operations":[{"op":"reorder","order":["A"]}]}'
    const ops = parseArrangeResult(resultText)
    expect(ops).toEqual([{ op: "reorder", order: ["A"] }])
  })

  it("classify 返回 workbench-arrange block", () => {
    const resultText =
      '已下发 1 条。\n{"marker":"WORKBENCH_ARRANGE_V1","operations":[{"op":"reorder","order":["A"]}]}'
    const block = workbenchArrangeHandler.classify(
      { toolName: "arrange_workbench", toolCallId: "tc1", resultText } as any,
      "msg1",
      0
    )
    expect(block).toMatchObject({ kind: "workbench-arrange", toolCallId: "tc1" })
  })
})
