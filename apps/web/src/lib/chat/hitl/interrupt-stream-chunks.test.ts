import { describe, expect, it } from "vitest"

import { createLangChainStreamParseState } from "../langchain-stream-parser"
import {
  buildHitlInterruptStreamChunks,
  collectHitlToolCallIdsAlreadyStreamed,
} from "./interrupt-stream-chunks"

describe("buildHitlInterruptStreamChunks", () => {
  const messageParts = [
    {
      type: "tool-delete_employees_batch",
      toolCallId: "call_4b93",
      state: "input-available",
      input: { employee_ids: "[25, 26, 27, 28, 29]" },
    },
  ]

  it("emits tool chunks when tool was not streamed yet", () => {
    const chunks = buildHitlInterruptStreamChunks(messageParts)
    expect(chunks.map((c) => c.type)).toEqual([
      "tool-input-start",
      "tool-input-available",
    ])
  })

  it("skips toolCallIds already sent input-available in parse state", () => {
    const state = createLangChainStreamParseState()
    const key = "pending-0"
    state.pendingToolCalls.set(key, {
      key,
      messageChunkId: "msg-1",
      index: 0,
      toolCallId: "call_4b93",
      toolName: "delete_employees_batch",
      inputText: '{"employee_ids":"[25]"}',
      sentInputStart: true,
      sentInputAvailable: true,
      sentEarlyPathInput: false,
      lastParseAttemptLength: 0,
    })

    const skip = collectHitlToolCallIdsAlreadyStreamed(state)
    expect(skip.has("call_4b93")).toBe(true)

    const chunks = buildHitlInterruptStreamChunks(messageParts, {
      skipToolCallIds: skip,
    })
    expect(chunks).toHaveLength(0)
  })
})
