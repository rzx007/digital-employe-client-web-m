import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"

import { patchAssistantWithInterruptParts } from "./session-patch"

describe("patchAssistantWithInterruptParts", () => {
  it("replaces parts with interrupt message_parts instead of appending", () => {
    const prev: UIMessage[] = [
      {
        id: "client-1",
        role: "assistant",
        parts: [
          { type: "text", text: "流式重复文案", state: "done" },
          {
            type: "tool-delete_employees_batch",
            toolCallId: "call_a",
            state: "input-available",
            input: { employee_ids: "[]" },
          },
        ],
      },
    ]

    const storedParts = [
      { type: "text", text: "落库唯一文案", state: "done" },
      {
        type: "tool-delete_employees_batch",
        toolCallId: "call_a",
        state: "input-available",
        input: { employee_ids: "[25, 26]" },
      },
    ]

    const next = patchAssistantWithInterruptParts(prev, {
      message_id: 99,
      message_parts: storedParts,
    })

    expect(next).toHaveLength(1)
    expect(next[0].id).toBe("99")
    expect(next[0].parts).toEqual(storedParts)
    expect(
      (next[0] as UIMessage & { metadata?: { streamState?: string } })
        .metadata?.streamState
    ).toBe("interrupted")
  })
})
