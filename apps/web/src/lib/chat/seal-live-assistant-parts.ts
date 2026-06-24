import type { UIMessage } from "ai"

/**
 * 终止流式时「定格」最后一条仍在流式的 assistant 消息：保留其当前已累积 parts，
 * 并在 metadata 标记 streamState="cancelled"。对齐 hermes turnController.interruptTurn
 * 的「先封存 partial 再清空」——让停止瞬间 UI 立即显示「已停止」终态，而非短暂空白等收尾。
 *
 * 不修改入参：返回新数组 + 新消息对象（React 状态不可变更新）。最后一条非 assistant
 * （如用户刚发出、尚无 assistant 回复）或空数组 → 原样返回。
 */
export function sealLiveAssistantParts(messages: UIMessage[]): UIMessage[] {
  if (messages.length === 0) return messages
  const lastIndex = messages.length - 1
  const last = messages[lastIndex]
  if (last.role !== "assistant") return messages

  const prevMeta =
    last.metadata && typeof last.metadata === "object"
      ? (last.metadata as Record<string, unknown>)
      : {}

  const sealed: UIMessage = {
    ...last,
    metadata: { ...prevMeta, streamState: "cancelled" },
  } as UIMessage

  const next = messages.slice()
  next[lastIndex] = sealed
  return next
}
