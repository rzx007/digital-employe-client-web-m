import type { UIMessage } from "ai"

import type { Message } from "@/types/chat"

type MessageWithMeta = UIMessage & {
  metadata?: { streamState?: string }
}

const TERMINAL_STREAM_STATES = new Set(["completed", "error", "cancelled"])

export function isTerminalAssistantStreamState(
  streamState: string | null | undefined
): boolean {
  return (
    typeof streamState === "string" && TERMINAL_STREAM_STATES.has(streamState)
  )
}

export function lastAssistantStreamState(
  messages: UIMessage[]
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue
    return (msg as MessageWithMeta).metadata?.streamState
  }
  return undefined
}

export function lastStoredAssistantStreamState(
  messages: Message[]
): string | null | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") {
      return messages[i].streamState
    }
  }
  return undefined
}

/** DB/composer 最后一条 assistant 为 queued：尚未真正流式输出，勿显示「正在生成…」 */
export function isAssistantQueued(messages: UIMessage[]): boolean {
  return lastAssistantStreamState(messages) === "queued"
}

export function isStoredAssistantQueued(
  streamState: string | null | undefined
): boolean {
  return streamState === "queued"
}

/** 编排派单排队占位文案（开流后不应再展示为正文） */
export function isOrchestrationQueuePlaceholder(text: string | null | undefined): boolean {
  if (!text) return false
  const t = text.trim()
  if (
    t === "已加入执行队列，等待其他对话完成" ||
    t === "等待总管会话结束，即将开始执行…" ||
    t === "排队中，等待执行"
  ) {
    return true
  }
  return (
    t.includes("已加入执行队列") ||
    t.includes("等待总管会话结束") ||
    t.includes("排队中，等待")
  )
}

export function shouldHideStaleQueuePlaceholder(
  streamState: string | null | undefined,
  content: string | null | undefined
): boolean {
  if (streamState !== "streaming") return false
  return isOrchestrationQueuePlaceholder(content)
}