import { describe, expect, it } from "vitest"

import {
  parseTasksDeletedPayload,
  resolveTasksDeletedBlockKind,
} from "./task-deleted-tool-payload"

describe("parseTasksDeletedPayload", () => {
  it("parses batch delete success payload", () => {
    const payload = parseTasksDeletedPayload(
      JSON.stringify({
        type: "tasks_deleted",
        total: 2,
        succeeded_count: 2,
        failed_count: 0,
        succeeded: [
          { index: 1, task_id: 31, task_name: "日报" },
          { index: 2, task_id: 32, task_name: "周报" },
        ],
        failed: [],
        message: "已成功删除 2 个任务",
      })
    )

    expect(payload?.succeeded_count).toBe(2)
    expect(payload?.succeeded[0]?.task_name).toBe("日报")
  })

  it("parses partial failure payload", () => {
    const payload = parseTasksDeletedPayload(
      JSON.stringify({
        type: "tasks_deleted",
        total: 2,
        succeeded_count: 1,
        failed_count: 1,
        succeeded: [{ index: 1, task_id: 31, task_name: "日报" }],
        failed: [{ index: 2, task_id: 99, error: "任务 #99 不存在。" }],
      })
    )

    expect(payload?.failed_count).toBe(1)
    expect(payload?.failed[0]?.error).toContain("不存在")
  })
})

describe("resolveTasksDeletedBlockKind", () => {
  it("maps delete_tasks_batch JSON to tasks-deleted block", () => {
    expect(
      resolveTasksDeletedBlockKind(
        "delete_tasks_batch",
        "output-available",
        JSON.stringify({ type: "tasks_deleted", total: 0, succeeded: [], failed: [] })
      )
    ).toBe("tasks-deleted")
  })

  it("maps plain error to tasks-deleted block", () => {
    expect(
      resolveTasksDeletedBlockKind(
        "delete_tasks_batch",
        "output-available",
        "错误：task_ids 不能为空。"
      )
    ).toBe("tasks-deleted")
  })

  it("ignores other tools", () => {
    expect(
      resolveTasksDeletedBlockKind("delete_task", "output-available", "{}")
    ).toBeNull()
  })
})
