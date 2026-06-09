import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"
import type { TaskExecution } from "@/types/schedule-monitor"
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

function exec(id: number, endedAtMs: number): TaskExecution {
  return {
    id,
    run_status: "success",
    started_at: iso(endedAtMs - 1000),
    ended_at: iso(endedAtMs),
  } as unknown as TaskExecution
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
  return entries.map((e) =>
    e.kind === "message" ? `msg:${e.data.id}` : `exec:${e.data.id}`
  )
}

describe("buildCuratorTimeline 尾部乐观消息排序", () => {
  it("摘要消息时间晚于 ended_at 时，乐观用户消息仍排在任务卡片之后", () => {
    // 历史 assistant（有真实 created_at，早于任务）+ 尾部乐观 user（无 created_at→ts=0）
    const displayMessages = [
      msg("a1", "assistant", T - 10_000),
      msg("u-optimistic", "user"),
    ]
    const executions = [exec(1, T)] // 任务 ended_at = T
    // 摘要消息 created_at = T + 5000（晚于 ended_at）→ 卡片 ts 被抬到 T+6000
    const stored = [summaryStored(1, T + 5_000)]

    const order = orderKeys(
      buildCuratorTimeline(displayMessages, executions, stored)
    )
    const iExec = order.indexOf("exec:1")
    const iUser = order.indexOf("msg:u-optimistic")
    expect(iExec).toBeGreaterThanOrEqual(0)
    expect(iUser).toBeGreaterThan(iExec) // 用户消息必须在任务卡片之后
  })

  it("无摘要消息时也排在任务卡片之后（不回归）", () => {
    const displayMessages = [
      msg("a1", "assistant", T - 10_000),
      msg("u-optimistic", "user"),
    ]
    const executions = [exec(1, T)]
    const order = orderKeys(buildCuratorTimeline(displayMessages, executions, []))
    expect(order.indexOf("msg:u-optimistic")).toBeGreaterThan(
      order.indexOf("exec:1")
    )
  })
})
