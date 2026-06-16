import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"
import type { Message as ChatMessage } from "@/types/chat"
import { buildCuratorTimeline } from "./build-curator-timeline"

const T = 1_700_000_000_000 // 固定基准 ms

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function msg(
  id: string,
  role: "user" | "assistant",
  createdAtMs?: number
): UIMessage {
  return {
    id,
    role,
    parts: [],
    ...(createdAtMs != null
      ? { metadata: { created_at: iso(createdAtMs) } }
      : {}),
  } as unknown as UIMessage
}

function summaryStored(execId: number, tsMs: number): ChatMessage {
  return {
    id: `sum-${execId}`,
    role: "assistant",
    timestamp: new Date(tsMs),
    metadata: {
      source: "orchestrator_execution_summary",
      execution_log_id: execId,
    },
  } as unknown as ChatMessage
}

function orderKeys(entries: ReturnType<typeof buildCuratorTimeline>): string[] {
  return entries.map((e) => `msg:${e.data.id}`)
}

describe("buildCuratorTimeline 执行不入时间线", () => {
  it("success 执行不出现在时间线（只含 msg:* 条目）", () => {
    const displayMessages = [msg("a1", "assistant", T - 10_000)]
    const stored = [summaryStored(1, T + 5_000)]

    const order = orderKeys(buildCuratorTimeline(displayMessages, stored))
    expect(order).not.toContain("exec:1")
    expect(order).toEqual(["msg:a1"])
  })

  it("running/queued 执行不出现在时间线", () => {
    const displayMessages = [msg("u1", "user", T - 5_000)]
    const order = orderKeys(buildCuratorTimeline(displayMessages, []))
    expect(order).not.toContain("exec:7")
    expect(order).toEqual(["msg:u1"])
  })

  it("只含 msg:* 条目，不含任何 exec:* 条目（混合消息场景）", () => {
    const displayMessages = [
      msg("a1", "assistant", T - 10_000),
      msg("u1", "user", T - 5_000),
    ]
    const stored = [summaryStored(1, T + 5_000)]

    const entries = buildCuratorTimeline(displayMessages, stored)
    for (const entry of entries) {
      expect(entry.kind).toBe("message")
    }
    const keys = orderKeys(entries)
    expect(keys).toEqual(["msg:a1", "msg:u1"])
  })
})

describe("buildCuratorTimeline 尾部乐观消息排序", () => {
  it("有时间戳历史消息后的乐观 user 消息排在其后", () => {
    const displayMessages = [
      msg("a1", "assistant", T - 10_000),
      msg("u-optimistic", "user"),
    ]

    const order = orderKeys(buildCuratorTimeline(displayMessages, []))
    const iA1 = order.indexOf("msg:a1")
    const iUser = order.indexOf("msg:u-optimistic")
    expect(iA1).toBeGreaterThanOrEqual(0)
    expect(iUser).toBeGreaterThan(iA1)
  })

  it("无 storedMessages 时乐观消息仍排在有时间戳消息之后", () => {
    const displayMessages = [
      msg("a1", "assistant", T - 10_000),
      msg("u-optimistic", "user"),
    ]
    const order = orderKeys(buildCuratorTimeline(displayMessages, []))
    expect(order.indexOf("msg:u-optimistic")).toBeGreaterThan(
      order.indexOf("msg:a1")
    )
  })
})
