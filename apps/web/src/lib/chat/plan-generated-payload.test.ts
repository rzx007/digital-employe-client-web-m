import { describe, expect, it } from "vitest"

import {
  parsePlanGeneratedOutput,
  parsePlanTasksFromInput,
  parsePlanTasksFromOutput,
  planRequiresManualConfirmation,
  resolvePlanTasksForCard,
} from "./plan-generated-payload"

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

describe("parsePlanGeneratedOutput", () => {
  it("parses plan_id from tool result first line", () => {
    const output = parsePlanGeneratedOutput(
      '{"type":"plan_generated","plan_id":45,"summary":"测试","total_tasks":1}\n\n编排计划已生成'
    )
    expect(output?.plan_id).toBe(45)
    expect(output?.summary).toBe("测试")
  })

  it("parses requires_confirmation from tool result", () => {
    const complex = parsePlanGeneratedOutput(
      '{"type":"plan_generated","plan_id":46,"requires_confirmation":true,"tasks":[{"task_name":"定时查","execute_mode":"scheduled","cron":"0 9 * * *"}]}'
    )
    expect(complex?.requires_confirmation).toBe(true)

    const simple = parsePlanGeneratedOutput(
      '{"type":"plan_generated","plan_id":47,"requires_confirmation":false,"tasks":[{"task_name":"即时查"}]}'
    )
    expect(simple?.requires_confirmation).toBe(false)
  })
})

describe("planRequiresManualConfirmation", () => {
  it("returns true only when requires_confirmation is true", () => {
    expect(
      planRequiresManualConfirmation({
        type: "plan_generated",
        plan_id: 1,
        requires_confirmation: true,
      })
    ).toBe(true)
    expect(
      planRequiresManualConfirmation({
        type: "plan_generated",
        plan_id: 1,
        requires_confirmation: false,
      })
    ).toBe(false)
    expect(planRequiresManualConfirmation(null)).toBe(false)
    expect(
      planRequiresManualConfirmation({
        type: "plan_generated",
        plan_id: 1,
      })
    ).toBe(false)
  })
})

describe("resolvePlanTasksForCard", () => {
  it("prefers tasks from resultText over input", () => {
    const tasks = resolvePlanTasksForCard(
      {
        summary: "输入摘要",
        tasks: [{ task_name: "输入任务", execute_mode: "immediate" }],
      },
      '{"type":"plan_generated","plan_id":1,"tasks":[{"task_name":"输出任务","execute_mode":"scheduled","cron":"0 9 * * *"}]}'
    )
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.task_name).toBe("输出任务")
  })

  it("falls back to input when resultText has no tasks", () => {
    const tasks = resolvePlanTasksForCard(
      { tasks: [{ task_name: "输入任务" }] },
      '{"type":"plan_generated","plan_id":1}'
    )
    expect(tasks[0]?.task_name).toBe("输入任务")
  })
})

describe("parsePlanTasksFromOutput", () => {
  it("returns tasks array from resultText", () => {
    const tasks = parsePlanTasksFromOutput(
      '{"type":"plan_generated","plan_id":1,"tasks":[{"task_name":"A"}]}'
    )
    expect(tasks).toHaveLength(1)
  })
})
