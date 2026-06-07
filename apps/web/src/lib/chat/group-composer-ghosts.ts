import type { UIMessage } from "ai"

function readMeta(message: UIMessage): Record<string, unknown> | undefined {
  const meta = (message as UIMessage & { metadata?: Record<string, unknown> })
    .metadata
  return meta && typeof meta === "object" ? meta : undefined
}

/** 群时间线投影 / 流式临时态消息（有发言人或流式标记） */
export function isGroupTimelineAssistantMessage(message: UIMessage): boolean {
  const meta = readMeta(message)
  if (!meta) return false
  if (typeof meta.senderName === "string" && meta.senderName.length > 0) {
    return true
  }
  if (typeof meta.senderId === "string" && meta.senderId.length > 0) {
    return true
  }
  if (meta.streamState === "streaming") return true
  if (meta.clarify_target_conversation_id != null) return true
  if (meta.clarify_message_id != null) return true
  return false
}

export function assistantMessageHasVisibleBody(message: UIMessage): boolean {
  if (!message.parts?.length) return false
  return message.parts.some((p) => {
    if (
      p.type === "text" &&
      "text" in p &&
      typeof p.text === "string" &&
      p.text.trim().length > 0
    ) {
      return true
    }
    return typeof p.type === "string" && p.type.startsWith("tool-")
  })
}

/**
 * 群会话 useChat composer 里常会残留「空 assistant」：
 * - 发群消息时 SDK 收到 start→[DONE] 但无正文；
 * - 澄清 approve 后误把组长会话的 assistant 行 append 到群 composer。
 * 这些行没有时间线 metadata，渲染成「群拼图头像 / 空气泡」，应整行剔除。
 */
export function stripGhostComposerAssistants(
  messages: UIMessage[]
): UIMessage[] {
  const next = messages.filter((m) => {
    if (m.role !== "assistant") return true
    if (isGroupTimelineAssistantMessage(m)) return true
    if (assistantMessageHasVisibleBody(m)) return true
    return false
  })
  return next.length === messages.length ? messages : next
}
