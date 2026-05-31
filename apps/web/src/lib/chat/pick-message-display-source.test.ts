import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"

import { pickMessageDisplaySource } from "./pick-message-display-source"

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

  it("prefers stored when DB has newer message id at same length", () => {
    const live = [msg("1"), msg("client-temp")]
    const stored = [msg("1"), msg("2")]
    expect(pickMessageDisplaySource(live, stored, "ready")).toBe(stored)
  })
})
