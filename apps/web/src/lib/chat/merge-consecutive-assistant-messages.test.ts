import { describe, it, expect } from "vitest"
import type { UIMessage } from "ai"

import { mergeConsecutiveAssistantMessages } from "./merge-consecutive-assistant-messages"

describe("mergeConsecutiveAssistantMessages", () => {
  it("一组连续 assistant 含空壳 + 非空 → 合并保留非空 parts(不塌)", () => {
    const messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "派活" }] },
      { id: "10", role: "assistant", parts: [{ type: "text", text: "规划段" }] },
      { id: "11", role: "assistant", parts: [], metadata: { streamState: "streaming" } },
    ] as unknown as UIMessage[]
    const out = mergeConsecutiveAssistantMessages(messages)
    const merged = out.find((m) => m.role === "assistant")
    expect(
      merged?.parts?.some(
        (p) => p.type === "text" && "text" in p && p.text === "规划段"
      )
    ).toBe(true)
  })
})
