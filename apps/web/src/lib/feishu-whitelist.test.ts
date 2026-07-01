import { describe, expect, it } from "vitest"
import { appendOpenId } from "./feishu-whitelist"

describe("appendOpenId", () => {
  it("appends to empty", () => {
    expect(appendOpenId("", "ou_1")).toBe("ou_1")
  })
  it("dedups (trim)", () => {
    expect(appendOpenId("ou_1, ou_2", " ou_1 ")).toBe("ou_1,ou_2")
  })
  it("adds new comma-separated", () => {
    expect(appendOpenId("ou_1", "ou_2")).toBe("ou_1,ou_2")
  })
  it("ignores empty id", () => {
    expect(appendOpenId("ou_1", "")).toBe("ou_1")
  })
})
