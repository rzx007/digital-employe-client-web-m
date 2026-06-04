import { describe, expect, it } from "vitest"
import {
  MAX_STREAM_RESUME_ATTEMPTS,
  shouldAttemptResume,
} from "./resume-decision"

const ok = {
  hitlActive: false,
  lastAssistantStreamState: "streaming",
  lastAssistantId: "42",
  resumeAttempts: {} as Record<string, number>,
}

describe("shouldAttemptResume", () => {
  it("attempts resume when last assistant is streaming and not yet attempted", () => {
    expect(shouldAttemptResume(ok)).toBe(true)
  })
  it("does not resume while HITL is active", () => {
    expect(shouldAttemptResume({ ...ok, hitlActive: true })).toBe(false)
  })
  it("does not resume when last assistant is not streaming", () => {
    expect(
      shouldAttemptResume({ ...ok, lastAssistantStreamState: "completed" })
    ).toBe(false)
  })
  it("allows retry up to MAX_STREAM_RESUME_ATTEMPTS for the same assistant", () => {
    for (let i = 0; i < MAX_STREAM_RESUME_ATTEMPTS; i++) {
      expect(
        shouldAttemptResume({ ...ok, resumeAttempts: { "42": i } })
      ).toBe(true)
    }
    expect(
      shouldAttemptResume({
        ...ok,
        resumeAttempts: { "42": MAX_STREAM_RESUME_ATTEMPTS },
      })
    ).toBe(false)
  })
  it("resumes again for a different assistant id", () => {
    expect(
      shouldAttemptResume({
        ...ok,
        resumeAttempts: { "41": MAX_STREAM_RESUME_ATTEMPTS },
      })
    ).toBe(true)
  })
})
