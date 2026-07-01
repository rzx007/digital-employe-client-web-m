import { describe, expect, it } from "vitest"

import { externalDirAuthHandler } from "./tools/handlers/external-dir-auth"
import { EXTERNAL_DIR_TOOL_NAME } from "./hitl/constants"
import type { ToolViewModel } from "./tools/tool-view-model"

function mockExternalDirVm(
  overrides: Partial<ToolViewModel> & Pick<ToolViewModel, "state" | "resultText">
): ToolViewModel {
  return {
    toolCallId: "call_ext",
    toolName: EXTERNAL_DIR_TOOL_NAME,
    type: `tool-${EXTERNAL_DIR_TOOL_NAME}`,
    state: overrides.state,
    resultText: overrides.resultText,
    summary: { toolName: EXTERNAL_DIR_TOOL_NAME, label: "工作区外目录写授权" },
    input: { path: "/tmp/outside" },
    preliminary: false,
    displayContent: null,
    normalizedFilePath: null,
    editDiff: null,
    part: {} as ToolViewModel["part"],
    ...overrides,
  }
}

describe("externalDirAuthHandler.classify", () => {
  it("renders block for input-available (待确认)", () => {
    const vm = mockExternalDirVm({ state: "input-available", resultText: null })
    const block = externalDirAuthHandler.classify(vm, "msg-1", 0)
    expect(block).not.toBeNull()
    expect((block as { kind: string }).kind).toBe("external_dir_authorization")
    expect((block as { state?: string }).state).toBe("input-available")
  })

  it("renders block for output-available (已批准 → 已确认态)", () => {
    const vm = mockExternalDirVm({
      state: "output-available",
      resultText: "已授权",
    })
    const block = externalDirAuthHandler.classify(vm, "msg-1", 0)
    // 修复点：output-available 不再返回 null，让卡片渲染「授权已确认」
    expect(block).not.toBeNull()
    expect((block as { kind: string }).kind).toBe("external_dir_authorization")
    expect((block as { state?: string }).state).toBe("output-available")
  })

  it("renders block for output-error (已拒绝)", () => {
    const vm = mockExternalDirVm({
      state: "output-error",
      resultText: "用户拒绝授权",
    })
    const block = externalDirAuthHandler.classify(vm, "msg-1", 0)
    expect(block).not.toBeNull()
    expect((block as { state?: string }).state).toBe("output-error")
  })
})
