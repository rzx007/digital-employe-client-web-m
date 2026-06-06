export interface GroupClarifyTarget {
  conversationId: number
  messageId: number
}

/**
 * 群澄清卡片:从群消息 extra_meta 解析出应把 /approve 打到的"组长会话 + 中断消息"。
 * 群里的澄清问题消息由后端投影时写入这两个字段。
 */
export function resolveGroupClarifyTarget(
  meta: Record<string, unknown> | undefined | null,
): GroupClarifyTarget | null {
  if (!meta) return null
  const conv = meta.clarify_target_conversation_id
  const msg = meta.clarify_message_id
  if (typeof conv === "number" && typeof msg === "number") {
    return { conversationId: conv, messageId: msg }
  }
  return null
}
