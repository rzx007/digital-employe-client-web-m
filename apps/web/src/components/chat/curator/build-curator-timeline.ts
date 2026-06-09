import type { UIMessage } from "ai"
import type { TaskExecution } from "@/types/schedule-monitor"
import type { Message as ChatMessage } from "@/types/chat"
import { getMessageCreatedAtMs } from "../shared/chat-view-shared"

export type TimelineEntry =
  | { kind: "message"; data: UIMessage; ts: number }
  | { kind: "execution"; data: TaskExecution; ts: number }

const TERMINAL_EXECUTION_STATUSES = new Set([
  "success",
  "failed",
  "timeout",
  "cancelled",
])

function getMsgTs(msg: UIMessage, storedMessages: ChatMessage[]): number {
  return getMessageCreatedAtMs(msg, storedMessages) ?? 0
}

function getExecutionTimelineTs(exec: TaskExecution): number | null {
  const raw = exec.ended_at ?? exec.started_at
  if (!raw) return null
  const ms = new Date(raw).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * 执行卡片在时间线上的实际 ts：ended_at 与「摘要消息时间戳+1000」取较大者
 * （让卡片排在其摘要下方）。非终态/无有效时间返回 null（不入时间线）。
 */
function getExecutionCardTs(
  exec: TaskExecution,
  summaryTsByExecId: Map<number, number>
): number | null {
  if (!TERMINAL_EXECUTION_STATUSES.has(exec.run_status)) return null
  const tsRaw = getExecutionTimelineTs(exec)
  if (tsRaw == null) return null
  const summaryTs = summaryTsByExecId.get(exec.id)
  return summaryTs != null ? Math.max(tsRaw, summaryTs + 1000) : tsRaw
}

/** 摘要消息 execution_log_id → 时间戳（用于卡片排在摘要下方） */
function buildExecutionSummaryTsMap(
  storedMessages: ChatMessage[]
): Map<number, number> {
  const map = new Map<number, number>()
  for (const msg of storedMessages) {
    if (msg.role !== "assistant") continue
    const meta = msg.metadata
    if (!meta || typeof meta !== "object") continue
    if (meta.source !== "orchestrator_execution_summary") continue
    const execId = meta.execution_log_id
    if (typeof execId !== "number") continue
    const ts = msg.timestamp?.getTime()
    if (ts != null && Number.isFinite(ts)) {
      map.set(execId, ts)
    }
  }
  return map
}

/**
 * 总管时间线：合并消息与任务执行卡片，按 ts 升序。
 */
export function buildCuratorTimeline(
  displayMessages: UIMessage[],
  executions: TaskExecution[],
  storedMessages: ChatMessage[]
): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  const summaryTsByExecId = buildExecutionSummaryTsMap(storedMessages)

  // 卡片实际 ts 的最大值（含摘要抬升 summaryTs+1000）。尾部 live 消息必须压过它，
  // 否则带摘要的任务卡片会反超刚发出的用户消息、排到其上方（刷新前）。
  let maxCardTs = 0
  for (const exec of executions) {
    const ts = getExecutionCardTs(exec, summaryTsByExecId)
    if (ts != null && ts > maxCardTs) maxCardTs = ts
  }

  let lastRealTsIndex = -1
  for (let i = 0; i < displayMessages.length; i++) {
    if (getMsgTs(displayMessages[i], storedMessages) > 0) {
      lastRealTsIndex = i
    }
  }

  // 无时间戳（如 useChat 客户端 id 尚未与 DB 对齐）时按展示顺序递推 ts，
  // 避免 refetch 后 resume assistant 的真实 created_at 把 user 行排到其下方。
  // 尾部 live 消息须压过任务卡片，否则新对话会排在执行卡片上方。
  let lastKnownTs = 0
  for (let i = 0; i < displayMessages.length; i++) {
    const msg = displayMessages[i]
    let ts = getMsgTs(msg, storedMessages)
    if (ts === 0) {
      const bump = lastKnownTs + 1000
      ts = i > lastRealTsIndex ? Math.max(bump, maxCardTs + 1000) : bump
    } else if (ts <= lastKnownTs) {
      ts = lastKnownTs + 1000
    }
    lastKnownTs = ts
    entries.push({ kind: "message", data: msg, ts })
  }

  for (const exec of executions) {
    const ts = getExecutionCardTs(exec, summaryTsByExecId)
    if (ts == null) continue
    entries.push({ kind: "execution", data: exec, ts })
  }

  entries.sort((a, b) => a.ts - b.ts)
  return entries
}
