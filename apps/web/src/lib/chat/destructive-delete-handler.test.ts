import { describe, expect, it } from "vitest"

import { employeeCrudHandler } from "./tools/handlers/employee-crud"
import { destructiveDeleteHandler } from "./tools/handlers/destructive-delete"
import { isDestructiveDeleteRejected } from "./hitl/aborted-output"
import { DESTRUCTIVE_DELETE_REJECT_MESSAGE } from "./hitl/constants"
import type { ToolViewModel } from "./tools/tool-view-model"

function mockDeleteEmployeeVm(
  overrides: Partial<ToolViewModel> & Pick<ToolViewModel, "state" | "resultText">
): ToolViewModel {
  return {
    toolCallId: "call_del",
    toolName: "delete_employee",
    type: "tool-delete_employee",
    state: overrides.state,
    resultText: overrides.resultText,
    summary: { toolName: "delete_employee", label: "删除员工" },
    input: { employee_id: 2 },
    preliminary: false,
    displayContent: null,
    normalizedFilePath: null,
    editDiff: null,
    part: {} as ToolViewModel["part"],
    ...overrides,
  }
}

describe("destructive delete cancel rendering", () => {
  it("detects cancel reject message for card state", () => {
    expect(isDestructiveDeleteRejected(DESTRUCTIVE_DELETE_REJECT_MESSAGE)).toBe(
      true
    )
    expect(isDestructiveDeleteRejected("错误：不能删除总管助手。")).toBe(false)
  })

  it("classifies user reject via destructiveDeleteHandler", () => {
    const vm = mockDeleteEmployeeVm({
      state: "output-error",
      resultText: DESTRUCTIVE_DELETE_REJECT_MESSAGE,
    })

    expect(destructiveDeleteHandler.classify(vm, "msg-1", 0)?.kind).toBe(
      "destructive-delete"
    )
    expect(employeeCrudHandler.classify(vm, "msg-1", 1)).toBeNull()
  })

  it("still routes real delete_employee errors to employee-deleted", () => {
    const vm = mockDeleteEmployeeVm({
      state: "output-error",
      resultText: "错误：不能删除总管助手。",
    })

    expect(destructiveDeleteHandler.classify(vm, "msg-1", 0)).toBeNull()
    expect(employeeCrudHandler.classify(vm, "msg-1", 0)?.kind).toBe(
      "employee-deleted"
    )
  })
})
