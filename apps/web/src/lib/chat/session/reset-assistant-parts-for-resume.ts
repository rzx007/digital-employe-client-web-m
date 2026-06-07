import type { UIMessage } from "ai"

/**
 * 全量重放 resume 前，把 composer 里末尾那条正在流式的 assistant 消息清成「空壳」
 * （保留 id + role，清空 parts）。
 *
 * 为什么必须清空（已对 ai@6 SDK 源码坐实）：
 * - resume 时 useChat 用末尾 assistant 消息（同 id）做 in-place 整条替换的基底
 *   （createStreamingUIMessageState 复用 lastMessage 而非新建）；
 * - 但 SDK 的 text part **不按 id upsert**：resume 流里每个 `text-start` 都 push 一个
 *   新 part，不会找 parts[] 里断线前已渲染的旧 text part 复用；
 * - 故若不先清空，全量重放（从 seq 0 重建整条消息）会把新 part 叠加在旧 part 之上 →
 *   断点前的前缀**重复**。清空后，全量重放重建出干净的整条消息，等同「拿后端权威
 *   快照原地覆盖整条气泡」（opencode 的「不丢不重」在本 SDK 上的正确形态）。
 *
 * tool part 按 toolCallId 幂等 upsert、不受影响；只有 text/reasoning 需要靠清空兜底。
 *
 * id 必须保留：resume 流的 start chunk 不带 messageId，SDK 沿用本消息 id 做
 * replaceLastMessage 判定（id 相同→原地替换整条，不同→冒出第二条气泡）。
 *
 * @returns 新数组（末尾 assistant 已清空）；若没有可清空的 assistant 则返回原数组（同引用）。
 */
export function resetLastAssistantPartsForResume(
  messages: UIMessage[]
): UIMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue
    if (!msg.parts || msg.parts.length === 0) return messages
    const next = [...messages]
    next[i] = { ...msg, parts: [] }
    return next
  }
  return messages
}
