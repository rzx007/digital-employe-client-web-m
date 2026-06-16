import type { UIMessage } from "ai"
import type { Message as ChatMessage } from "@/types/chat"
import { getMessageCreatedAtMs } from "../shared/chat-view-shared"

export type TimelineEntry = { kind: "message"; data: UIMessage; ts: number }

function getMsgTs(msg: UIMessage, storedMessages: ChatMessage[]): number {
  return getMessageCreatedAtMs(msg, storedMessages) ?? 0
}

/**
 * 总管时间线：只含消息条目，按 ts 升序。
 * 执行卡片由常驻面板（A2）承载，不再插入时间线。
 */
export function buildCuratorTimeline(
  displayMessages: UIMessage[],
  storedMessages: ChatMessage[]
): TimelineEntry[] {
  const entries: TimelineEntry[] = []

  // 无时间戳（如 useChat 客户端 id 尚未与 DB 对齐）时按展示顺序递推 ts，
  // 避免 refetch 后 resume assistant 的真实 created_at 把 user 行排到其下方。
  let lastKnownTs = 0
  for (const msg of displayMessages) {
    let ts = getMsgTs(msg, storedMessages)
    if (ts === 0) {
      ts = lastKnownTs + 1000
    } else if (ts <= lastKnownTs) {
      ts = lastKnownTs + 1000
    }
    lastKnownTs = ts
    entries.push({ kind: "message", data: msg, ts })
  }

  entries.sort((a, b) => a.ts - b.ts)
  return entries
}
