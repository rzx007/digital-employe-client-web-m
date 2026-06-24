import { describe, it, expect } from "vitest"
import type { UIMessage } from "ai"

import { shouldShowBottomStreamingIndicator } from "./bottom-streaming-indicator"

const userMsg = (id: string): UIMessage =>
  ({
    id,
    role: "user",
    parts: [{ type: "text", text: "查微博热搜 + 小米17价格" }],
  }) as unknown as UIMessage

const baseArgs = {
  status: "streaming" as const,
  contactType: "employee" as string | undefined,
  hideStreamingIndicator: false,
  isDraftMode: false,
  hasError: false,
  messages: [userMsg("u1")],
  composerMessages: [userMsg("u1")],
  storedAssistantStreamState: null as string | null | undefined,
}

describe("shouldShowBottomStreamingIndicator", () => {
  it("1:1 员工会话流式中 → 显示底部指示器", () => {
    expect(shouldShowBottomStreamingIndicator(baseArgs)).toBe(true)
  })

  it("群会话流式中 → 不显示底部指示器（群用时间线内占位，避免两条「正在生成回复」）", () => {
    // 这是本次 bug：群发首条消息后，底部 ChatStreamingIndicator 与时间线内
    // computeGroupExtraMessages 的占位同时出现两条「正在生成回复...」。
    expect(
      shouldShowBottomStreamingIndicator({
        ...baseArgs,
        contactType: "group",
      })
    ).toBe(false)
  })

  it("总管会话流式中 → 仍显示底部指示器（非群，时间线无占位）", () => {
    expect(
      shouldShowBottomStreamingIndicator({
        ...baseArgs,
        contactType: "curator",
      })
    ).toBe(true)
  })

  it("status=ready → 不显示", () => {
    expect(
      shouldShowBottomStreamingIndicator({ ...baseArgs, status: "ready" })
    ).toBe(false)
  })

  it("hideStreamingIndicator=true → 不显示（群深链只读快照）", () => {
    expect(
      shouldShowBottomStreamingIndicator({
        ...baseArgs,
        hideStreamingIndicator: true,
      })
    ).toBe(false)
  })

  it("草稿态 → 不显示", () => {
    expect(
      shouldShowBottomStreamingIndicator({ ...baseArgs, isDraftMode: true })
    ).toBe(false)
  })

  it("有错误 → 不显示", () => {
    expect(
      shouldShowBottomStreamingIndicator({ ...baseArgs, hasError: true })
    ).toBe(false)
  })

  it("无任何消息 → 不显示", () => {
    expect(
      shouldShowBottomStreamingIndicator({ ...baseArgs, messages: [] })
    ).toBe(false)
  })

  it("composer 末条 assistant 为 queued → 不显示", () => {
    const queued = {
      id: "a1",
      role: "assistant",
      parts: [{ type: "text", text: "" }],
      metadata: { streamState: "queued" },
    } as unknown as UIMessage
    expect(
      shouldShowBottomStreamingIndicator({
        ...baseArgs,
        composerMessages: [userMsg("u1"), queued],
      })
    ).toBe(false)
  })

  it("DB 末条 assistant 已终态 → 不显示", () => {
    expect(
      shouldShowBottomStreamingIndicator({
        ...baseArgs,
        storedAssistantStreamState: "completed",
      })
    ).toBe(false)
  })
})
