import { describe, expect, it } from "vitest"
import { seedActiveHitlFromStoredMessages } from "./seed-active-hitl"
import type { Message } from "@/types/chat"

const base = { content: "", role: "assistant" as const, timestamp: new Date() }

describe("seedActiveHitlFromStoredMessages", () => {
  it("skips approved interrupted rows", () => {
    const rows = [{
      ...base, id: "10", streamState: "interrupted",
      metadata: { approved_at: "2026-01-01T00:00:00Z" },
      messageParts: [{ type: "tool-submit_clarifying_questions", toolCallId: "c1", state: "input-available" }],
    }] as unknown as Message[]
    expect(seedActiveHitlFromStoredMessages(rows)).toBeNull()
  })
  it("seeds from the latest unapproved interrupted row", () => {
    const rows = [{
      ...base, id: "11", streamState: "interrupted", metadata: {},
      messageParts: [{ type: "tool-submit_clarifying_questions", toolCallId: "c2", state: "input-available" }],
    }] as unknown as Message[]
    expect(seedActiveHitlFromStoredMessages(rows)?.toolCallId).toBe("c2")
  })
})
