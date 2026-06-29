import { describe, expect, it } from "vitest"

import { mergeConsecutiveToolGroups } from "./merge-consecutive-tool-groups"
import type { ClassifiedBlock, ToolGroupItem } from "./message-classifier"

function tool(toolName: string, idx: number, label: string): ToolGroupItem {
  return {
    key: `m:tool:${toolName}:${idx}`,
    toolCallId: `${toolName}-${idx}`,
    toolName,
    type: `tool-${toolName}`,
    state: "output-available",
    summary: { toolName, label, icon: "🔧" },
    resultText: null,
    input: {},
    preliminary: false,
    displayContent: null,
    normalizedFilePath: null,
    editDiff: null,
    part: {} as ToolGroupItem["part"],
  }
}

function group(
  toolName: string,
  idx: number,
  label = toolName
): ClassifiedBlock {
  return {
    kind: "tool-group",
    key: `m:tgroup:${idx}`,
    tools: [tool(toolName, idx, label)],
    summary: label,
  }
}

function text(t: string, idx: number): ClassifiedBlock {
  return { kind: "final-response", key: `m:text:${idx}`, text: t }
}

describe("mergeConsecutiveToolGroups: 合并所有连续工具调用", () => {
  it("连续同名部件工具合并成单组", () => {
    const blocks = [
      group("add_workbench_widget", 0),
      group("add_workbench_widget", 1),
      group("add_workbench_widget", 2),
    ]
    const out = mergeConsecutiveToolGroups(blocks)
    expect(out).toHaveLength(1)
    const g = out[0] as Extract<ClassifiedBlock, { kind: "tool-group" }>
    expect(g.tools).toHaveLength(3)
    expect(g.summary).toBe("3 项操作 (3 次添加工作台小部件)")
  })

  it("不同类型的连续工具也合并（shell + 部件 + 文件）", () => {
    const blocks = [
      group("execute", 0, "执行 a"),
      group("add_workbench_widget", 1),
      group("read_file", 2, "读取 b"),
    ]
    const out = mergeConsecutiveToolGroups(blocks)
    expect(out).toHaveLength(1)
    const g = out[0] as Extract<ClassifiedBlock, { kind: "tool-group" }>
    expect(g.tools).toHaveLength(3)
  })

  it("连续同名文件工具合并并按工具名计数", () => {
    const blocks = [
      group("read_file", 0, "读取 a"),
      group("read_file", 1, "读取 b"),
    ]
    const out = mergeConsecutiveToolGroups(blocks)
    expect(out).toHaveLength(1)
    const g = out[0] as Extract<ClassifiedBlock, { kind: "tool-group" }>
    expect(g.tools).toHaveLength(2)
    expect(g.summary).toBe("2 项操作 (2 次读取)")
  })

  it("被文本打断的连续工具会分成两组", () => {
    const blocks = [
      group("add_workbench_widget", 0),
      group("execute", 1, "执行"),
      text("插入说明", 2),
      group("read_file", 3, "读取"),
      group("add_workbench_widget", 4),
    ]
    const out = mergeConsecutiveToolGroups(blocks)
    expect(out.map((b) => b.kind)).toEqual([
      "tool-group",
      "final-response",
      "tool-group",
    ])
    expect(
      (out[0] as Extract<ClassifiedBlock, { kind: "tool-group" }>).tools
    ).toHaveLength(2)
    expect(
      (out[2] as Extract<ClassifiedBlock, { kind: "tool-group" }>).tools
    ).toHaveLength(2)
  })

  it("孤立工具保持单组，key 与 summary 不变", () => {
    const lone = group("add_workbench_widget", 0, "添加工作台小部件")
    const out = mergeConsecutiveToolGroups([lone])
    expect(out).toHaveLength(1)
    const g = out[0] as Extract<ClassifiedBlock, { kind: "tool-group" }>
    expect(g.key).toBe("m:tgroup:0")
    expect(g.tools).toHaveLength(1)
    expect(g.summary).toBe("添加工作台小部件")
  })

  it("非工具块原样保留、互不吞并", () => {
    const blocks = [text("开场", 0), text("结尾", 1)]
    const out = mergeConsecutiveToolGroups(blocks)
    expect(out).toHaveLength(2)
    expect(out.map((b) => b.kind)).toEqual(["final-response", "final-response"])
  })
})
