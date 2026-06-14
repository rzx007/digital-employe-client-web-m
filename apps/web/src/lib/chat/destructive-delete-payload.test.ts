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
    expect(preview?.title).toBe("解聘数字员工")
    expect(preview?.detailLines).toEqual(["员工 ID：12"])
  })

  it("parses delete_employees_batch employee_ids JSON", () => {
    const preview = buildDestructiveDeletePreview("delete_employees_batch", {
      employee_ids: "[12, 13]",
    })
    expect(preview?.title).toBe("批量解聘数字员工")
    expect(preview?.detailLines).toEqual(["员工 ID：12", "员工 ID：13"])
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

  it("builds delete_workspace_skill preview", () => {
    const preview = buildDestructiveDeletePreview("delete_workspace_skill", {
      skill_name: "frontend-demo",
    })
    expect(preview?.title).toBe("删除工作区技能")
    expect(preview?.detailLines).toEqual(["技能：frontend-demo"])
  })

  it("parses delete_workspace_skills_batch skill_names JSON", () => {
    const preview = buildDestructiveDeletePreview(
      "delete_workspace_skills_batch",
      { skill_names: '["frontend-demo", "ppt-maker"]' }
    )
    expect(preview?.title).toBe("批量删除工作区技能")
    expect(preview?.detailLines).toEqual([
      "技能：frontend-demo",
      "技能：ppt-maker",
    ])
  })

  it("returns null for invalid input", () => {
    expect(
      buildDestructiveDeletePreview("delete_task", { task_id: "abc" })
    ).toBeNull()
    expect(
      buildDestructiveDeletePreview("delete_tasks_batch", { task_ids: "[]" })
    ).toBeNull()
    expect(
      buildDestructiveDeletePreview("delete_workspace_skill", {
        skill_name: "",
      })
    ).toBeNull()
    expect(
      buildDestructiveDeletePreview("delete_workspace_skills_batch", {
        skill_names: "[]",
      })
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
