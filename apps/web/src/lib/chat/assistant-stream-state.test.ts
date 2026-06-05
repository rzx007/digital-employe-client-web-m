import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"

import {
  isAssistantQueued,
  isOrchestrationQueuePlaceholder,
  isTerminalAssistantStreamState,
  lastAssistantStreamState,
  shouldHideStaleQueuePlaceholder,
} from "./assistant-stream-state"

describe("assistant-stream-state", () => {
  it("detects queued last assistant", () => {
    const messages = [
      { id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        id: "2",
        role: "assistant",
        parts: [{ type: "text", text: "等待总管…" }],
        metadata: { streamState: "queued" },
      },
    ] as UIMessage[]
    expect(lastAssistantStreamState(messages)).toBe("queued")
    expect(isAssistantQueued(messages)).toBe(true)
  })

  it("streaming is not queued", () => {
    const messages = [
      {
        id: "2",
        role: "assistant",
        parts: [],
        metadata: { streamState: "streaming" },
      },
    ] as UIMessage[]
    expect(isAssistantQueued(messages)).toBe(false)
  })

  it("detects terminal stream states", () => {
    expect(isTerminalAssistantStreamState("completed")).toBe(true)
    expect(isTerminalAssistantStreamState("streaming")).toBe(false)
    expect(isTerminalAssistantStreamState("queued")).toBe(false)
  })

  it("detects orchestration queue placeholder", () => {
    expect(
      isOrchestrationQueuePlaceholder("已加入执行队列，等待其他对话完成")
    ).toBe(true)
    expect(
      shouldHideStaleQueuePlaceholder(
        "streaming",
        "已加入执行队列，等待其他对话完成"
      )
    ).toBe(true)
    expect(
      shouldHideStaleQueuePlaceholder(
        "queued",
        "已加入执行队列，等待其他对话完成"
      )
    ).toBe(false)
  })
})
