import { describe, expect, it } from "vitest"

import {
  parseEmployeeDeletedPayload,
  parseEmployeeDetailPayload,
  parseEmployeeUpdatedPayload,
  resolveEmployeeCrudBlockKind,
  skillLabelsFromDetailSkills,
} from "./employee-crud-tool-payload"

describe("parseEmployeeCrudPayloads", () => {
  it("parses employee_detail", () => {
    const payload = parseEmployeeDetailPayload(
      JSON.stringify({
        type: "employee_detail",
        employee_id: 12,
        employee_name: "数据分析师",
        employee_code: "12",
        description: "负责分析",
        is_curator: false,
        skills: [{ skill_name_zh: "SQL" }],
        mcps: [],
      })
    )

    expect(payload?.employee_id).toBe(12)
    expect(payload?.employee_name).toBe("数据分析师")
    expect(skillLabelsFromDetailSkills(payload!.skills)).toEqual(["SQL"])
  })

  it("parses employee_updated", () => {
    const payload = parseEmployeeUpdatedPayload(
      JSON.stringify({
        type: "employee_updated",
        employee_id: 3,
        employee_name: "法务助手",
        skills: ["合同审查"],
        message: "员工「法务助手」（ID=3）已更新。",
      })
    )

    expect(payload?.employee_name).toBe("法务助手")
    expect(payload?.skills).toEqual(["合同审查"])
  })

  it("parses employee_deleted", () => {
    const payload = parseEmployeeDeletedPayload(
      JSON.stringify({
        type: "employee_deleted",
        employee_id: 4,
        employee_name: "临时员工",
        message: "员工「临时员工」（ID=4）已删除。",
      })
    )

    expect(payload?.employee_id).toBe(4)
    expect(payload?.message).toContain("已删除")
  })
})

describe("resolveEmployeeCrudBlockKind", () => {
  it("maps plain error on update_employee", () => {
    expect(
      resolveEmployeeCrudBlockKind(
        "update_employee",
        "output-available",
        "错误：不能修改总管助手。"
      )
    ).toBe("employee-updated")
  })

  it("maps get_employee success payload", () => {
    expect(
      resolveEmployeeCrudBlockKind(
        "get_employee",
        "output-available",
        JSON.stringify({
          type: "employee_detail",
          employee_id: 1,
          employee_name: "A",
          is_curator: false,
          skills: [],
          mcps: [],
        })
      )
    ).toBe("employee-detail")
  })
})
