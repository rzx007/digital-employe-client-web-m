import { describe, expect, it } from "vitest"

import {
  isBatchMutationAllFailed,
  isToolOutputPending,
} from "./tool-output-pending"

describe("isToolOutputPending", () => {
  it("treats preliminary output-available as pending", () => {
    expect(isToolOutputPending("output-available", true)).toBe(true)
    expect(isToolOutputPending("output-available", false)).toBe(false)
  })

  it("treats input phases as pending", () => {
    expect(isToolOutputPending("input-streaming")).toBe(true)
    expect(isToolOutputPending("call")).toBe(true)
  })
})

describe("isBatchMutationAllFailed", () => {
  it("returns false for partial streaming counts", () => {
    expect(
      isBatchMutationAllFailed({
        total: 2,
        succeeded_count: 0,
        failed_count: 1,
      })
    ).toBe(false)
  })

  it("returns true when all items failed and counts match total", () => {
    expect(
      isBatchMutationAllFailed({
        total: 2,
        succeeded_count: 0,
        failed_count: 2,
      })
    ).toBe(true)
  })
})
