import { describe, expect, it } from "vitest"

import { parsePlanTasksFromInput } from "./plan-generated-payload"

describe("parsePlanTasksFromInput", () => {
  it("parses tasks JSON string", () => {
    const tasks = parsePlanTasksFromInput({
      summary: "计划",
      tasks: '[{"task_name":"查热搜","employee_id":4}]',
    })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.task_name).toBe("查热搜")
  })

  it("parses tasks array from tool call input", () => {
    const tasks = parsePlanTasksFromInput({
      summary: "立即查询一次抖音热搜",
      tasks: [
        {
          task_id: 45,
          employee_id: 4,
          task_name: "立即查询抖音热搜",
          prompt: "请查询",
        },
      ],
    })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.employee_id).toBe(4)
    expect(tasks[0]?.task_id).toBe(45)
  })

  it("returns empty for invalid tasks", () => {
    expect(parsePlanTasksFromInput({ summary: "x", tasks: "not-json" })).toEqual(
      []
    )
    expect(parsePlanTasksFromInput(null)).toEqual([])
  })
})
