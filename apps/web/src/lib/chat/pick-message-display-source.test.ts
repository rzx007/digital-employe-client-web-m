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

  it("streaming 期：无空壳可填 → 返回同一引用(no-op,避免重渲染churn)", () => {
    const live: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        id: "99",
        role: "assistant",
        parts: [{ type: "text", text: "已有内容" }],
        metadata: { streamState: "streaming" },
      },
    ]
    const stored: UIMessage[] = [
      {
        id: "99",
        role: "assistant",
        parts: [{ type: "text", text: "DB" }],
        metadata: { streamState: "streaming" },
      },
    ]
    const out = pickMessageDisplaySource(live, stored, "streaming")
    expect(out).toBe(live)
  })

  it("streaming 期：空壳在中间(非末条)也能从 DB 回退", () => {
    const live: UIMessage[] = [
      { id: "50", role: "assistant", parts: [], metadata: { streamState: "streaming" } },
      { id: "u2", role: "user", parts: [{ type: "text", text: "下一句" }] },
    ]
    const stored: UIMessage[] = [
      {
        id: "50",
        role: "assistant",
        parts: [{ type: "text", text: "中间那条的正文" }],
        metadata: { streamState: "streaming" },
      },
      { id: "u2", role: "user", parts: [{ type: "text", text: "下一句" }] },
    ]
    const out = pickMessageDisplaySource(live, stored, "streaming")
    expect(out.find((m) => m.id === "50")?.parts?.[0]).toMatchObject({
      text: "中间那条的正文",
    })
  })

  // 切流拖影根因②：切回后 useChat 重置、resume 仅重建当前轮 assistant，composer 比
  // DB 短。streaming 分支若只渲染 composer，会把前面整段历史(上一轮 user+assistant)
  // 整体吞掉 → 「卡片之上、上一轮消息也缺失，二次进来才回来」。期望：以 DB 为底补齐
  // 历史，仅当前轮用 live 的实时 parts。
  it("streaming 期：live 比 DB 短(resume 刚接上) → 前面整段历史不被吞", () => {
    const live: UIMessage[] = [
      {
        id: "303",
        role: "assistant",
        parts: [{ type: "text", text: "本轮实时重放" }],
        metadata: { streamState: "streaming" },
      },
    ]
    const stored: UIMessage[] = [
      { id: "300", role: "user", parts: [{ type: "text", text: "上一轮问题" }] },
      { id: "301", role: "assistant", parts: [{ type: "text", text: "上一轮答复" }] },
      { id: "302", role: "user", parts: [{ type: "text", text: "本轮问题" }] },
      {
        id: "303",
        role: "assistant",
        parts: [{ type: "text", text: "DB 旧快照(脏)" }],
        metadata: { streamState: "streaming" },
      },
    ]
    const out = pickMessageDisplaySource(live, stored, "streaming")
    const ids = out.map((m) => m.id)
    // 历史四条都在、顺序保留
    expect(ids).toEqual(["300", "301", "302", "303"])
    // 当前轮(303)用 live 的实时 parts，而非 DB 旧快照
    expect(out.find((m) => m.id === "303")?.parts?.[0]).toMatchObject({
      text: "本轮实时重放",
    })
  })

  it("streaming 期：live 比 DB 短且当前轮是空壳 → 历史补齐 + 空壳用 DB 回退", () => {
    const live: UIMessage[] = [
      { id: "303", role: "assistant", parts: [], metadata: { streamState: "streaming" } },
    ]
    const stored: UIMessage[] = [
      { id: "300", role: "user", parts: [{ type: "text", text: "上一轮问题" }] },
      {
        id: "303",
        role: "assistant",
        parts: [{ type: "text", text: "DB 已落的本轮正文" }],
        metadata: { streamState: "streaming" },
      },
    ]
    const out = pickMessageDisplaySource(live, stored, "streaming")
    expect(out.map((m) => m.id)).toEqual(["300", "303"])
    expect(out.find((m) => m.id === "303")?.parts?.[0]).toMatchObject({
      text: "DB 已落的本轮正文",
    })
  })
})
