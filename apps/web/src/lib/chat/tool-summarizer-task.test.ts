import { describe, expect, it } from "vitest"

import { summarizeToolCall } from "./tool-summarizer"

describe("summarizeToolCall: 并行子任务 task", () => {
  it("用 description 当标签（task 未注册进 display map，须在兜底前处理）", () => {
    const s = summarizeToolCall({
      type: "tool-task",
      input: {
        description: "调研华为昇腾910B AI芯片，撰写调研报告并写入产物目录",
        subagent_type: "general-purpose",
      },
    })
    expect(s.toolName).toBe("task")
    expect(s.label.startsWith("子任务 · ")).toBe(true)
    expect(s.label).toContain("昇腾910B")
    // 关键回归点：绝不能是光秃的 "task"
    expect(s.label).not.toBe("task")
  })

  it("无 description 时回退到 subagent_type", () => {
    const s = summarizeToolCall({
      type: "tool-task",
      input: { subagent_type: "general-purpose" },
    })
    expect(s.label).toBe("子任务 · general-purpose")
  })

  it("input 为空（流式起始）时回退到「子任务」，不显示光秃 task", () => {
    const s = summarizeToolCall({ type: "tool-task", input: undefined })
    expect(s.label).toBe("子任务")
    expect(s.label).not.toBe("task")
  })

  it("超长 description 截断", () => {
    const long = "调研".repeat(80)
    const s = summarizeToolCall({
      type: "tool-task",
      input: { description: long },
    })
    expect(s.label.length).toBeLessThan(long.length + 10)
    expect(s.label.endsWith("...")).toBe(true)
  })
})
