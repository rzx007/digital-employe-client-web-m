import { describe, expect, it } from "vitest"

import {
  isRecruitmentPlainToolError,
  resolveRecruitmentToolBlockKind,
  shouldRenderRecruitmentToolBlock,
} from "./recruitment-tool-payload"

describe("isRecruitmentPlainToolError", () => {
  it("detects plain-text tool errors", () => {
    expect(isRecruitmentPlainToolError("错误：创建员工失败 — 员工名称已存在")).toBe(
      true
    )
    expect(isRecruitmentPlainToolError('{"type":"employee_hired"}')).toBe(false)
    expect(isRecruitmentPlainToolError(null)).toBe(false)
    expect(isRecruitmentPlainToolError("")).toBe(false)
  })
})

describe("resolveRecruitmentToolBlockKind", () => {
  it("maps hire_employee plain error to employee-hired block", () => {
    expect(
      resolveRecruitmentToolBlockKind(
        "hire_employee",
        "output-available",
        "错误：创建员工失败 — 员工名称已存在"
      )
    ).toBe("employee-hired")
  })

  it("maps hire_employees plain error to employees-hired block", () => {
    expect(
      resolveRecruitmentToolBlockKind(
        "hire_employees",
        "output-available",
        "错误：candidates 不能为空。"
      )
    ).toBe("employees-hired")
  })

  it("maps recruit_employee plain error to recruitment-candidates block", () => {
    expect(
      resolveRecruitmentToolBlockKind(
        "recruit_employee",
        "output-available",
        "错误：招聘需求描述不能为空。"
      )
    ).toBe("recruitment-candidates")
  })

  it("returns null for unrelated tool", () => {
    expect(
      resolveRecruitmentToolBlockKind(
        "list_tasks",
        "output-available",
        "错误：foo"
      )
    ).toBeNull()
  })
})

describe("shouldRenderRecruitmentToolBlock", () => {
  it("renders while tool is running without payload", () => {
    expect(
      shouldRenderRecruitmentToolBlock("input-available", null, false)
    ).toBe(true)
  })

  it("renders output-error without payload", () => {
    expect(
      shouldRenderRecruitmentToolBlock("output-error", null, false)
    ).toBe(true)
  })
})
