import { describe, expect, it, vi } from "vitest"
import type { UIMessage } from "ai"

// vitest 默认不处理静态资源 import，mock 飞书 PNG 为占位字符串。
vi.mock("@/assets/channels/飞书.png", () => ({ default: "feishu.png" }))

import {
  isAssistantQueued,
  isOrchestrationQueuePlaceholder,
  isTerminalAssistantStreamState,
  lastAssistantStreamState,
  getDispatchBadge,
  getChannelBadge,
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

  it("dispatch badge for orchestrator", () => {
    expect(getDispatchBadge({ dispatchedByOrchestrator: true })).toEqual({
      label: "总管派单",
      title: "总管自动派单消息（非真人发送）",
    })
    expect(getDispatchBadge({})).toBeNull()
  })

  it("channel badge for feishu source", () => {
    const badge = getChannelBadge({ channel: "feishu" })
    expect(badge?.name).toBe("飞书")
    expect(typeof badge?.logo).toBe("string")
    expect(getChannelBadge({})).toBeNull()
    expect(getChannelBadge(undefined)).toBeNull()
    expect(getChannelBadge({ channel: "unknown" })).toBeNull()
  })
})
