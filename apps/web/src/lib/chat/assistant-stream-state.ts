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