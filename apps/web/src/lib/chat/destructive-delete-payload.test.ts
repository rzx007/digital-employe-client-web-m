import { describe, expect, it } from "vitest"

import {
  buildDestructiveDeletePreview,
  isDestructiveDeletePendingState,
} from "./destructive-delete-payload"

describe("buildDestructiveDeletePreview", () => {
  it("builds delete_employee preview", () => {
    const preview = buildDestructiveDeletePreview("delete_employee", {
      employee_id: 12,
    })
    expect(preview?.title).toBe("删除数字员工")
    expect(preview?.detailLines).toEqual(["员工 ID：12"])
  })

  it("builds delete_task preview", () => {
    const preview = buildDestructiveDeletePreview("delete_task", {
      task_id: 31,
    })
    expect(preview?.title).toBe("删除子任务")
    expect(preview?.detailLines).toEqual(["任务 ID：#31"])
  })

  it("parses delete_tasks_batch task_ids JSON", () => {
    const preview = buildDestructiveDeletePreview("delete_tasks_batch", {
      task_ids: "[31, 32, 99]",
    })
    expect(preview?.title).toBe("批量删除子任务")
    expect(preview?.detailLines).toEqual([
      "任务 ID：#31",
      "任务 ID：#32",
      "任务 ID：#99",
    ])
  })

  it("returns null for invalid input", () => {
    expect(
      buildDestructiveDeletePreview("delete_task", { task_id: "abc" })
    ).toBeNull()
    expect(
      buildDestructiveDeletePreview("delete_tasks_batch", { task_ids: "[]" })
    ).toBeNull()
  })
})

describe("isDestructiveDeletePendingState", () => {
  it("treats call and input states as pending", () => {
    expect(isDestructiveDeletePendingState("call")).toBe(true)
    expect(isDestructiveDeletePendingState("input-streaming")).toBe(true)
    expect(isDestructiveDeletePendingState("input-available")).toBe(true)
    expect(isDestructiveDeletePendingState("output-available")).toBe(false)
  })
})
