import type { UIMessage } from "ai"

import {
  isAssistantQueued,
  isStoredAssistantQueued,
  isTerminalAssistantStreamState,
} from "./assistant-stream-state"

export interface BottomStreamingIndicatorArgs {
  status: "submitted" | "streaming" | "ready" | "error"
  /** 联系人类型（"group" / "curator" / "employee" …） */
  contactType: string | undefined
  hideStreamingIndicator: boolean
  isDraftMode: boolean
  hasError: boolean
  /** 展示列表（空则无内容，不显示） */
  messages: UIMessage[]
  /** useChat composer（取末条 assistant 的 queued 态） */
  composerMessages: UIMessage[]
  /** DB 侧末条 assistant 的 streamState（抑制误显示） */
  storedAssistantStreamState: string | null | undefined
}

/**
 * 是否显示底部通用「正在生成回复...」指示器（ChatStreamingIndicator）。
 *
 * 群会话排除在外：群在时间线**内部**用 computeGroupExtraMessages 的占位
 * 表达组长「正在生成」态。若底部再叠一条通用指示器，群发首条消息后会**同时**
 * 出现两条「正在生成回复...」（时间线内占位 + 底部灰底气泡，背景不同）——
 * 这正是用户截图里的双占位 bug。群的 loading 态唯一真相是时间线内占位。
 */
export function shouldShowBottomStreamingIndicator(
  args: BottomStreamingIndicatorArgs
): boolean {
  const {
    status,
    contactType,
    hideStreamingIndicator,
    isDraftMode,
    hasError,
    messages,
    composerMessages,
    storedAssistantStreamState,
  } = args

  if (contactType === "group") return false
  if (hideStreamingIndicator) return false
  if (isDraftMode) return false
  if (status !== "submitted" && status !== "streaming") return false
  if (hasError) return false
  if (messages.length === 0) return false
  if (isAssistantQueued(composerMessages)) return false
  if (isStoredAssistantQueued(storedAssistantStreamState)) return false
  if (isTerminalAssistantStreamState(storedAssistantStreamState ?? undefined)) {
    return false
  }
  return true
}
