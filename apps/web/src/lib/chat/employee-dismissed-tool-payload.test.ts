import { describe, expect, it } from "vitest"

import {
  parseEmployeesDismissedPayload,
  resolveEmployeesDismissedBlockKind,
} from "./employee-dismissed-tool-payload"

describe("parseEmployeesDismissedPayload", () => {
  it("parses batch dismiss success payload", () => {
    const payload = parseEmployeesDismissedPayload(
      JSON.stringify({
        type: "employees_dismissed",
        total: 2,
        succeeded_count: 2,
        failed_count: 0,
        succeeded: [
          { index: 1, employee_id: 12, employee_name: "张三" },
          { index: 2, employee_id: 13, employee_name: "李四" },
        ],
        failed: [],
        message: "已成功解聘 2 人：张三、李四。",
      })
    )

    expect(payload?.succeeded_count).toBe(2)
    expect(payload?.succeeded[0]?.employee_name).toBe("张三")
  })

  it("parses partial failure payload", () => {
    const payload = parseEmployeesDismissedPayload(
      JSON.stringify({
        type: "employees_dismissed",
        total: 2,
        succeeded_count: 1,
        failed_count: 1,
        succeeded: [{ index: 1, employee_id: 12, employee_name: "张三" }],
        failed: [{ index: 2, employee_id: 99, error: "不能解聘总管助手。" }],
      })
    )

    expect(payload?.failed_count).toBe(1)
    expect(payload?.failed[0]?.error).toContain("总管助手")
    expect(payload?.failed[0]?.employee_id).toBe(99)
  })

  it("ignores non-matching payload types", () => {
    expect(
      parseEmployeesDismissedPayload(
        JSON.stringify({ type: "tasks_deleted", total: 0 })
      )
    ).toBeNull()
  })
})

describe("resolveEmployeesDismissedBlockKind", () => {
  it("maps delete_employees_batch JSON to employees-dismissed block", () => {
    expect(
      resolveEmployeesDismissedBlockKind(
        "delete_employees_batch",
        "output-available",
        JSON.stringify({
          type: "employees_dismissed",
          total: 0,
          succeeded: [],
          failed: [],
        })
      )
    ).toBe("employees-dismissed")
  })

  it("maps plain error to employees-dismissed block", () => {
    expect(
      resolveEmployeesDismissedBlockKind(
        "delete_employees_batch",
        "output-available",
        "错误：employee_ids 不能为空。"
      )
    ).toBe("employees-dismissed")
  })

  it("ignores other tools", () => {
    expect(
      resolveEmployeesDismissedBlockKind(
        "delete_employee",
        "output-available",
        "{}"
      )
    ).toBeNull()
  })
})
