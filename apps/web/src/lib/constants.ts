/** 与 Conversation.target_id（总管员工 id）及 SSE unread 聚合 key 一致 */
export function curatorUnreadKey(targetId: number | string): string {
  return `curator:${targetId}`
}
