import { describe, expect, it } from "vitest"
import { shouldAttemptResume } from "./resume-decision"

const ok = {
  hitlActive: false,
  lastAssistantStreamState: "streaming",
  lastAssistantId: "42",
  resumeAttemptedFor: null as string | null,
}

describe("shouldAttemptResume", () => {
  it("attempts resume when last assistant is streaming and not yet attempted", () => {
    expect(shouldAttemptResume(ok)).toBe(true)
  })
  it("does not resume while HITL is active", () => {
    expect(shouldAttemptResume({ ...ok, hitlActive: true })).toBe(false)
  })
  it("does not resume when last assistant is not streaming", () => {
    expect(shouldAttemptResume({ ...ok, lastAssistantStreamState: "completed" })).toBe(false)
  })
  it("does not resume twice for the same assistant id", () => {
    expect(shouldAttemptResume({ ...ok, resumeAttemptedFor: "42" })).toBe(false)
  })
  it("resumes again for a different assistant id", () => {
    expect(shouldAttemptResume({ ...ok, resumeAttemptedFor: "41" })).toBe(true)
  })
})
