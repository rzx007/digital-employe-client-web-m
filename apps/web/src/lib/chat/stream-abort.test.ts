import { describe, expect, it } from "vitest"

import { isBenignStreamAbortError } from "./stream-abort"

describe("isBenignStreamAbortError", () => {
  it("recognizes AbortError by name", () => {
    expect(isBenignStreamAbortError({ name: "AbortError", message: "x" })).toBe(
      true
    )
  })

  it("recognizes ofetch resume abort message", () => {
    const err = {
      name: "FetchError",
      message:
        '"http://localhost:34567/chat/conversations/261/stream/resume": <no response> signal is aborted without reason',
    }
    expect(isBenignStreamAbortError(err)).toBe(true)
  })

  it("does not treat real failures as benign", () => {
    expect(
      isBenignStreamAbortError(new Error("恢复聊天请求失败 (500)"))
    ).toBe(false)
  })
})
