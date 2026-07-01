import { describe, expect, it } from "vitest"

import { hitlKindFromToolType } from "./kind"

describe("hitlKindFromToolType", () => {
  it("maps clarify / document-plan / bug-report tool types", () => {
    expect(hitlKindFromToolType("tool-submit_clarifying_questions")).toBe(
      "clarify"
    )
    expect(hitlKindFromToolType("tool-submit_document_plan")).toBe(
      "document-plan"
    )
    expect(hitlKindFromToolType("tool-submit_bug_report")).toBe("bug-report")
  })

  it("maps every destructive HITL tool to destructive-delete", () => {
    for (const name of [
      "delete_employee",
      "delete_employees_batch",
      "delete_task",
      "delete_tasks_batch",
    ]) {
      expect(hitlKindFromToolType(`tool-${name}`)).toBe("destructive-delete")
    }
  })

  it("maps request_external_dir_access to external_dir_authorization", () => {
    expect(hitlKindFromToolType("tool-request_external_dir_access")).toBe(
      "external_dir_authorization"
    )
  })

  it("returns null for non-HITL tools and malformed types", () => {
    expect(hitlKindFromToolType("tool-read_file")).toBeNull()
    expect(hitlKindFromToolType("text")).toBeNull()
    // 行为保持：未带 tool- 前缀的裸工具名不匹配（与收敛前两份实现一致）
    expect(hitlKindFromToolType("submit_clarifying_questions")).toBeNull()
    expect(hitlKindFromToolType("delete_employee")).toBeNull()
  })
})
