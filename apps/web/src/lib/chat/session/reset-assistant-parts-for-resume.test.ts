import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"

import { resetLastAssistantPartsForResume } from "./reset-assistant-parts-for-resume"

function msg(
  id: string,
  role: "user" | "assistant",
  texts: string[]
): UIMessage {
  return {
    id,
    role,
    parts: texts.map((text) => ({ type: "text" as const, text })),
  }
}

describe("resetLastAssistantPartsForResume", () => {
  it("clears the last assistant message's parts but keeps id+role", () => {
    const input = [
      msg("u1", "user", ["hi"]),
      msg("a1", "assistant", ["partial answer so far"]),
    ]
    const out = resetLastAssistantPartsForResume(input)

    expect(out).not.toBe(input) // new array
    expect(out[1].id).toBe("a1") // id preserved → SDK in-place replace
    expect(out[1].role).toBe("assistant")
    expect(out[1].parts).toEqual([]) // shell for clean full-replay rebuild
    expect(out[0]).toBe(input[0]) // earlier messages untouched (same ref)
  })

  it("only clears the LAST assistant, not earlier ones", () => {
    const input = [
      msg("a1", "assistant", ["first turn answer"]),
      msg("u1", "user", ["follow up"]),
      msg("a2", "assistant", ["second turn partial"]),
    ]
    const out = resetLastAssistantPartsForResume(input)

    expect(out[0].parts).toHaveLength(1) // earlier assistant kept
    expect(out[2].parts).toEqual([]) // only last assistant cleared
  })

  it("returns same reference when last assistant already empty (no-op)", () => {
    const input = [msg("u1", "user", ["hi"]), msg("a1", "assistant", [])]
    expect(resetLastAssistantPartsForResume(input)).toBe(input)
  })

  it("returns same reference when there is no assistant message", () => {
    const input = [msg("u1", "user", ["hi"])]
    expect(resetLastAssistantPartsForResume(input)).toBe(input)
  })

  it("returns same reference for empty input", () => {
    const input: UIMessage[] = []
    expect(resetLastAssistantPartsForResume(input)).toBe(input)
  })
})
