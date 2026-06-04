import { describe, expect, it } from "vitest"
import { terminalToStreamState } from "./terminal-state"

describe("terminalToStreamState", () => {
  it("maps no_stream to error", () => {
    expect(terminalToStreamState("no_stream")).toBe("error")
  })
  it("passes through other terminal statuses verbatim", () => {
    for (const s of ["completed", "cancelled", "error", "interrupted"]) {
      expect(terminalToStreamState(s)).toBe(s)
    }
  })
})
