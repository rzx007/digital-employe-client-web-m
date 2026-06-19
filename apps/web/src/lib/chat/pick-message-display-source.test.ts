import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"

import {
  applyStoredPartsToInterruptedAssistants,
  pickMessageDisplaySource,
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

  it("streaming 期：live 末条 assistant 是空壳 → 用 DB 同 id 的 parts 回退", () => {
    const live: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "派活" }] },
      { id: "99", role: "assistant", parts: [], metadata: { streamState: "streaming" } },
    ]
    const stored: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "派活" }] },
      {
        id: "99",
        role: "assistant",
        parts: [{ type: "text", text: "已答完的正文" }],
        metadata: { streamState: "streaming" },
      },
    ]
    const out = pickMessageDisplaySource(live, stored, "streaming")
    const assistant = out.find((m) => m.id === "99")
    expect(assistant?.parts?.length).toBe(1)
    expect(assistant?.parts?.[0]).toMatchObject({ text: "已答完的正文" })
  })

  it("streaming 期：live assistant 已有内容(非空壳) → 不被 DB 覆盖(保留 live)", () => {
    const live: UIMessage[] = [
      {
        id: "99",
        role: "assistant",
        parts: [{ type: "text", text: "live 正在写的新内容" }],
        metadata: { streamState: "streaming" },
      },
    ]
    const stored: UIMessage[] = [
      {
        id: "99",
        role: "assistant",
        parts: [{ type: "text", text: "DB 旧内容" }],
        metadata: { streamState: "streaming" },
      },
    ]
    const out = pickMessageDisplaySource(live, stored, "streaming")
    expect(out.find((m) => m.id === "99")?.parts?.[0]).toMatchObject({
      text: "live 正在写的新内容",
    })
  })

  it("streaming 期：空壳但 DB 无同 id → 原样(仍空壳, 不崩)", () => {
    const live: UIMessage[] = [
      { id: "99", role: "assistant", parts: [], metadata: { streamState: "streaming" } },
    ]
    const stored: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "x" }] },
    ]
    const out = pickMessageDisplaySource(live, stored, "streaming")
    expect(out.find((m) => m.id === "99")?.parts?.length).toBe(0)
  })
})
