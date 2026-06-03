import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"

import {
  applyStoredPartsToInterruptedAssistants,
  pickMessageDisplaySource,
} from "./pick-message-display-source"

describe("applyStoredPartsToInterruptedAssistants", () => {
  it("uses stored parts for interrupted assistant awaiting approval", () => {
    const live: UIMessage[] = [
      {
        id: "42",
        role: "assistant",
        parts: [
          { type: "text", text: "live 重复" },
          { type: "text", text: "live 重复" },
        ],
        metadata: { streamState: "interrupted" },
      },
    ]
    const stored: UIMessage[] = [
      {
        id: "42",
        role: "assistant",
        parts: [{ type: "text", text: "db 单段文案" }],
        metadata: { streamState: "interrupted" },
      },
    ]

    const next = applyStoredPartsToInterruptedAssistants(live, stored)
    expect(next[0].parts).toHaveLength(1)
    expect(next[0].parts[0]).toMatchObject({ text: "db 单段文案" })
  })
})

describe("pickMessageDisplaySource", () => {
  it("merges stored parts into live when counts match and not streaming", () => {
    const live: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        id: "42",
        role: "assistant",
        parts: [
          { type: "text", text: "dup" },
          { type: "text", text: "dup" },
        ],
        metadata: { streamState: "interrupted" },
      },
    ]
    const stored: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        id: "42",
        role: "assistant",
        parts: [{ type: "text", text: "canonical" }],
        metadata: { streamState: "interrupted" },
      },
    ]

    const source = pickMessageDisplaySource(live, stored, "ready")
    const assistant = source.find((m) => m.role === "assistant")
    expect(assistant?.parts).toHaveLength(1)
    expect(assistant?.parts[0]).toMatchObject({ text: "canonical" })
  })
})
