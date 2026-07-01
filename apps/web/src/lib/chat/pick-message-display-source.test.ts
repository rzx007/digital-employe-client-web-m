import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"

import {
  applyStoredPartsToInterruptedAssistants,
  hydrateEmptyAssistantShellsFromDb,
  pickMessageDisplaySource,
  preferStoredStructuredPartsWhenLiveTextOnly,
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
      {
        id: "99",
        role: "assistant",
        parts: [],
        metadata: { streamState: "streaming" },
      },
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

  it("ready 期：live 仅 text、DB 同 id 含 tool parts → 用 DB 结构化 parts", () => {
    const live: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        id: "42",
        role: "assistant",
        parts: [{ type: "text", text: "只有文字" }],
        metadata: { streamState: "streaming" },
      },
    ]
    const stored: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        id: "42",
        role: "assistant",
        parts: [
          { type: "text", text: "正文" },
          {
            type: "tool-submit_clarifying_questions",
            toolCallId: "c1",
            state: "input-available",
          },
        ],
        metadata: { streamState: "streaming" },
      },
    ]
    const out = pickMessageDisplaySource(live, stored, "ready")
    const assistant = out.find((m) => m.id === "42")
    expect(assistant?.parts).toHaveLength(2)
    expect(assistant?.parts?.[1]?.type).toMatch(/^tool-/)
  })

  it("submitted 期(切回会话)：live 落后 DB → 用 DB 快照含 parts", () => {
    const live: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
    ]
    const stored: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        id: "42",
        role: "assistant",
        parts: [
          { type: "text", text: "正在查员工" },
          {
            type: "tool-list_employees",
            toolCallId: "t1",
            state: "output-available",
          },
        ],
        metadata: { streamState: "streaming" },
      },
    ]
    const out = pickMessageDisplaySource(live, stored, "submitted")
    const assistant = out.find((m) => m.id === "42")
    expect(assistant?.parts?.length).toBe(2)
  })

  it("ready 期(回调通知就地刷新)：等长 live 末条 assistant 空壳 + DB 同 id 已落内容 → 回退 DB", () => {
    // 服务端发起的总管增量汇报：resume 走 no_stream 后末条被清成空壳，
    // 随后 DB refetch 带回已完成正文(等长、completed、非 interrupted)，
    // 旧逻辑等长分支只 patch interrupted 行 → 空壳保留 → 气泡塌空(切回才出)。
    const live: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "派活" }] },
      {
        id: "99",
        role: "assistant",
        parts: [],
        metadata: { streamState: "completed" },
      },
    ]
    const stored: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "派活" }] },
      {
        id: "99",
        role: "assistant",
        parts: [{ type: "text", text: "回调汇报正文" }],
        metadata: { streamState: "completed" },
      },
    ]
    const out = pickMessageDisplaySource(live, stored, "ready")
    const assistant = out.find((m) => m.id === "99")
    expect(assistant?.parts?.length).toBe(1)
    expect(assistant?.parts?.[0]).toMatchObject({ text: "回调汇报正文" })
  })
})

describe("preferStoredStructuredPartsWhenLiveTextOnly", () => {
  it("live 已有 tool parts 时不覆盖", () => {
    const live: UIMessage[] = [
      {
        id: "42",
        role: "assistant",
        parts: [
          { type: "text", text: "a" },
          { type: "tool-run", toolCallId: "t1", state: "input-available" },
        ],
      },
    ]
    const stored: UIMessage[] = [
      {
        id: "42",
        role: "assistant",
        parts: [
          { type: "text", text: "b" },
          { type: "tool-run", toolCallId: "t2", state: "input-available" },
        ],
      },
    ]
    expect(preferStoredStructuredPartsWhenLiveTextOnly(live, stored)).toBe(live)
  })
})

describe("hydrateEmptyAssistantShellsFromDb", () => {
  it("空壳 assistant 用 DB 同 id parts 回退；DB 无同 id 则原样", () => {
    const live: UIMessage[] = [
      { id: "99", role: "assistant", parts: [] },
      { id: "100", role: "assistant", parts: [] },
    ]
    const stored: UIMessage[] = [
      {
        id: "99",
        role: "assistant",
        parts: [{ type: "text", text: "DB 内容" }],
      },
    ]
    const out = hydrateEmptyAssistantShellsFromDb(live, stored)
    expect(out.find((m) => m.id === "99")?.parts?.[0]).toMatchObject({
      text: "DB 内容",
    })
    // 无 DB 同 id → 仍空壳
    expect(out.find((m) => m.id === "100")?.parts?.length).toBe(0)
  })

  it("无任何填充返回同引用(不制造无谓重渲染)", () => {
    const live: UIMessage[] = [
      {
        id: "99",
        role: "assistant",
        parts: [{ type: "text", text: "已有内容" }],
      },
    ]
    const stored: UIMessage[] = [
      {
        id: "99",
        role: "assistant",
        parts: [{ type: "text", text: "DB 内容" }],
      },
    ]
    expect(hydrateEmptyAssistantShellsFromDb(live, stored)).toBe(live)
  })
})
