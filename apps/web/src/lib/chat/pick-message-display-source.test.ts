import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"

import {
  patchComposerFromStoredWhenSameTurn,
  pickMessageDisplaySource,
} from "./pick-message-display-source"

function msg(id: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text: id, state: "done" }] }
}

describe("pickMessageDisplaySource", () => {
  it("uses live messages while streaming", () => {
    const live = [msg("a")]
    const stored = [msg("a"), msg("b")]
    expect(pickMessageDisplaySource(live, stored, "streaming")).toBe(live)
  })

  it("prefers stored history when live composer is shorter after stop", () => {
    const live = [msg("c")]
    const stored = [msg("a"), msg("b"), msg("c")]
    expect(pickMessageDisplaySource(live, stored, "ready")).toBe(stored)
  })

  it("keeps live composer after stream when DB only assigns numeric ids", () => {
    const live = [msg("1"), msg("client-temp")]
    const stored = [msg("1"), msg("2")]
    expect(pickMessageDisplaySource(live, stored, "ready")).toBe(live)
  })
})

describe("patchComposerFromStoredWhenSameTurn", () => {
  it("patches assistant id and streamState without replacing parts", () => {
    const live: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "hi", state: "done" }] },
      {
        id: "client-assistant",
        role: "assistant",
        parts: [{ type: "text", text: "answer", state: "done" }],
        metadata: { streamState: "streaming" },
      },
    ]
    const stored: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "hi", state: "done" }] },
      {
        id: "2",
        role: "assistant",
        parts: [{ type: "text", text: "from-db", state: "done" }],
        metadata: { streamState: "completed" },
      },
    ]

    const patched = patchComposerFromStoredWhenSameTurn(live, stored)
    expect(patched).not.toBeNull()
    expect(patched![1].id).toBe("2")
    expect(patched![1].parts).toEqual(live[1].parts)
    expect((patched![1] as { metadata?: { streamState?: string } }).metadata?.streamState).toBe(
      "completed"
    )
  })
})
