import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"

import {
  applyStoredPartsToInterruptedAssistants,
  pickMessageDisplaySource,
  shouldForceHydrateFromStored,
} from "./pick-message-display-source"

describe("applyStoredPartsToInterruptedAssistants", () => {
  it("uses stored parts for interrupted assistant awaiting approval", () => {
    const live: UIMessage[] = [
      {
        id: "42",
        role: "assistant",
        parts: [
          { type: "text", text: "live 重复" },
          { type: "text", text: "live 重复" },
        ],
        metadata: { streamState: "interrupted" },
      },
    ]
    const stored: UIMessage[] = [
      {
        id: "42",
        role: "assistant",
        parts: [{ type: "text", text: "db 单段文案" }],
        metadata: { streamState: "interrupted" },
      },
    ]

    const next = applyStoredPartsToInterruptedAssistants(live, stored)
    expect(next[0].parts).toHaveLength(1)
    expect(next[0].parts[0]).toMatchObject({ text: "db 单段文案" })
  })
})

describe("pickMessageDisplaySource", () => {
  it("merges stored parts into live when counts match and not streaming", () => {
    const live: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        id: "42",
        role: "assistant",
        parts: [
          { type: "text", text: "dup" },
          { type: "text", text: "dup" },
        ],
        metadata: { streamState: "interrupted" },
      },
    ]
    const stored: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        id: "42",
        role: "assistant",
        parts: [{ type: "text", text: "canonical" }],
        metadata: { streamState: "interrupted" },
      },
    ]

    const source = pickMessageDisplaySource(live, stored, "ready")
    const assistant = source.find((m) => m.role === "assistant")
    expect(assistant?.parts).toHaveLength(1)
    expect(assistant?.parts[0]).toMatchObject({ text: "canonical" })
  })

  it("prefers stored when useChat is streaming but DB turn is completed", () => {
    const live: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "task" }] },
      {
        id: "2",
        role: "assistant",
        parts: [{ type: "text", text: "等待总管会话结束，即将开始执行…" }],
        metadata: { streamState: "streaming" },
      },
    ]
    const stored: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "task" }] },
      {
        id: "2",
        role: "assistant",
        parts: [{ type: "text", text: "励磁分析调研报告已完成。" }],
        metadata: { streamState: "completed" },
      },
    ]

    const source = pickMessageDisplaySource(live, stored, "streaming")
    const assistant = source.find((m) => m.role === "assistant")
    expect(assistant?.parts[0]).toMatchObject({
      text: "励磁分析调研报告已完成。",
    })
  })

  it("prefers stored when useChat is streaming but DB is queued", () => {
    const live: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "task" }] },
      {
        id: "2",
        role: "assistant",
        parts: [{ type: "text", text: "partial stream" }],
        metadata: { streamState: "streaming" },
      },
    ]
    const stored: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "task" }] },
      {
        id: "2",
        role: "assistant",
        parts: [{ type: "text", text: "等待总管会话结束，即将开始执行…" }],
        metadata: { streamState: "queued" },
      },
    ]

    const source = pickMessageDisplaySource(live, stored, "streaming")
    const assistant = source.find((m) => m.role === "assistant")
    expect(assistant?.parts[0]).toMatchObject({
      text: "等待总管会话结束，即将开始执行…",
    })
  })
})

describe("shouldForceHydrateFromStored", () => {
  it("returns true when DB completed but composer still queued", () => {
    const live: UIMessage[] = [
      {
        id: "2",
        role: "assistant",
        parts: [{ type: "text", text: "等待总管…" }],
        metadata: { streamState: "streaming" },
      },
    ]
    const stored: UIMessage[] = [
      {
        id: "2",
        role: "assistant",
        parts: [{ type: "text", text: "报告已完成" }],
        metadata: { streamState: "completed" },
      },
    ]
    expect(shouldForceHydrateFromStored(live, stored)).toBe(true)
  })

  it("returns false when stored has no assistant message", () => {
    const live: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
    ]
    const stored: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
    ]
    expect(shouldForceHydrateFromStored(live, stored)).toBe(false)
  })
})
