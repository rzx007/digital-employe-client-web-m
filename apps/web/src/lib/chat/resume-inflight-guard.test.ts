import { describe, expect, it } from "vitest"

import { shouldSkipResumeWhenInFlight } from "./resume-inflight-guard"

describe("shouldSkipResumeWhenInFlight", () => {
  it("跳过：同一会话已有在飞 resume 连接", () => {
    expect(shouldSkipResumeWhenInFlight("42", "42")).toBe(true)
  })

  it("不跳过：在飞连接属于另一会话（应允许切会话续流）", () => {
    expect(shouldSkipResumeWhenInFlight("41", "42")).toBe(false)
  })

  it("不跳过：当前无在飞 resume 连接", () => {
    expect(shouldSkipResumeWhenInFlight(null, "42")).toBe(false)
  })
})
