import { describe, expect, it } from "vitest"

import {
  parseRecentItemConversationId,
  resolveWorkbenchCuratorPanel,
} from "./resolve-workbench-curator-panel"

describe("resolveWorkbenchCuratorPanel", () => {
  const conversations = [
    { id: "68", contactId: "1", title: "最新", updatedAt: new Date() },
    { id: "50", contactId: "1", title: "总管对话", updatedAt: new Date() },
  ] as const

  it("keeps workbench conversation while list is still loading", () => {
    const panel = resolveWorkbenchCuratorPanel({
      curatorContactId: "1",
      workbenchCuratorConversationId: "68",
      curatorConversations: [],
      curatorConversationsReady: false,
      defaultCuratorConversationId: "50",
    })
    expect(panel).toEqual({ mode: "conversation", conversationId: "68" })
  })

  it("keeps workbench conversation before list cache catches up", () => {
    const panel = resolveWorkbenchCuratorPanel({
      curatorContactId: "1",
      workbenchCuratorConversationId: "99",
      curatorConversations: [...conversations],
      curatorConversationsReady: true,
      defaultCuratorConversationId: "50",
    })
    expect(panel).toEqual({ mode: "conversation", conversationId: "99" })
  })

  it("ignores non-curator global conversation ids when list is ready", () => {
    const panel = resolveWorkbenchCuratorPanel({
      curatorContactId: "1",
      workbenchCuratorConversationId: "employee-42",
      curatorConversations: [...conversations],
      curatorConversationsReady: true,
      defaultCuratorConversationId: "50",
    })
    expect(panel).toEqual({ mode: "conversation", conversationId: "68" })
  })

  it("uses default curator conversation when list is empty", () => {
    const panel = resolveWorkbenchCuratorPanel({
      curatorContactId: "1",
      workbenchCuratorConversationId: null,
      curatorConversations: [],
      curatorConversationsReady: true,
      defaultCuratorConversationId: "50",
    })
    expect(panel).toEqual({ mode: "default", conversationId: "50" })
  })

  it("prefers most recent conversation over legacy default", () => {
    const panel = resolveWorkbenchCuratorPanel({
      curatorContactId: "1",
      workbenchCuratorConversationId: null,
      curatorConversations: [...conversations],
      curatorConversationsReady: true,
      defaultCuratorConversationId: "50",
    })
    expect(panel).toEqual({ mode: "conversation", conversationId: "68" })
  })
})

describe("parseRecentItemConversationId", () => {
  it("parses numeric conversation id", () => {
    expect(parseRecentItemConversationId({ id: "66" })).toBe("66")
  })

  it("returns null for placeholder ids", () => {
    expect(parseRecentItemConversationId({ id: "recent:1" })).toBeNull()
  })
})
