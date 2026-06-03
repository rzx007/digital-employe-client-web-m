import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"

import { dedupeHitlPartsInMessage } from "./parts-dedupe"

describe("dedupeHitlPartsInMessage", () => {
  it("removes stale pending when same toolCallId has output-available", () => {
    const message = {
      id: "1",
      role: "assistant",
      parts: [
        {
          type: "tool-delete_employees_batch",
          toolCallId: "call_a",
          state: "output-available",
          output: { text: "done" },
        },
        {
          type: "tool-delete_employees_batch",
          toolCallId: "call_a",
          state: "input-available",
          input: { employee_ids: "[1]" },
        },
      ],
    } as UIMessage

    const next = dedupeHitlPartsInMessage(message)
    const tools = next.parts.filter((p) => p.type.startsWith("tool-"))
    expect(tools).toHaveLength(1)
    expect((tools[0] as { state?: string }).state).toBe("output-available")
  })

  it("keeps only the last pending part for duplicate toolCallId", () => {
    const message = {
      id: "1",
      role: "assistant",
      parts: [
        { type: "text", text: "批量解聘" },
        {
          type: "tool-delete_employees_batch",
          toolCallId: "call_a",
          state: "input-available",
          input: { employee_ids: "[]" },
        },
        {
          type: "tool-delete_employees_batch",
          toolCallId: "call_a",
          state: "input-available",
          input: { employee_ids: "[25, 26]" },
        },
      ],
    } as UIMessage

    const next = dedupeHitlPartsInMessage(message)
    const tools = next.parts.filter((p) =>
      p.type.startsWith("tool-delete_employees_batch")
    )
    expect(tools).toHaveLength(1)
    expect(
      (tools[0] as { input?: { employee_ids?: string } }).input?.employee_ids
    ).toBe("[25, 26]")
  })

  it("keeps only the last duplicate text part", () => {
    const message = {
      id: "1",
      role: "assistant",
      parts: [
        { type: "text", text: "没关系，重新发起解聘流程" },
        { type: "text", text: "没关系，重新发起解聘流程" },
      ],
    } as UIMessage

    const next = dedupeHitlPartsInMessage(message)
    const texts = next.parts.filter((p) => p.type === "text")
    expect(texts).toHaveLength(1)
    expect((texts[0] as { text?: string }).text).toBe(
      "没关系，重新发起解聘流程"
    )
  })
})
