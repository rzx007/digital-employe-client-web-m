import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"

import {
  isGroupTimelineAssistantMessage,
  stripGhostComposerAssistants,
} from "./group-composer-ghosts"

describe("stripGhostComposerAssistants", () => {
  it("removes empty useChat assistant without timeline metadata", () => {
    const messages: UIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "再来一次" }] },
      { id: "a-ghost", role: "assistant", parts: [] },
    ]
    const next = stripGhostComposerAssistants(messages)
    expect(next).toHaveLength(1)
    expect(next[0]?.role).toBe("user")
  })

  it("keeps group timeline projection with senderName", () => {
    const messages: UIMessage[] = [
      {
        id: "g1",
        role: "assistant",
        parts: [{ type: "text", text: "需求不够清晰" }],
        metadata: { senderName: "组长" },
      } as UIMessage,
    ]
    expect(stripGhostComposerAssistants(messages)).toHaveLength(1)
    expect(isGroupTimelineAssistantMessage(messages[0]!)).toBe(true)
  })

  it("keeps streaming placeholder temp messages", () => {
    const messages: UIMessage[] = [
      {
        id: "stream-1",
        role: "assistant",
        parts: [{ type: "text", text: "" }],
        metadata: { senderName: "组长", streamState: "streaming" },
      } as UIMessage,
    ]
    expect(stripGhostComposerAssistants(messages)).toHaveLength(1)
  })
})
