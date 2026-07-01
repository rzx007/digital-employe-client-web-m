import { useEffect, useMemo } from "react"
import type { UIMessage } from "ai"

import { isToolUIPart } from "@/lib/chat/tools/tool-part"
import { normalizeToolPart } from "@/lib/chat/tools/normalize-tool-part"
import {
  useTasksPanelStore,
  type SubtaskCardItem,
} from "@/stores/tasks-panel-store"

function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/**
 * 从当前会话的 UIMessage 列表里聚合出全部并行子任务（deepagents task 工具调用）。
 *
 * 数据完全来自 stream-parser 已解析好的 message tool parts —— 不发新后端请求。
 * 每个 task 工具 part 经 normalizeToolPart 归一后映射为一张子任务卡片：
 * 标题取 input.description，状态取 part.state（含 preliminary），输出取 resultText
 * （与内联工具行展示的实时流式累积输出同源）。
 *
 * 同一 toolCallId 在流式过程中会多次出现于不同 message 快照，这里以 toolCallId
 * 去重并保留最后一次（最新）出现的状态/输出。
 */
export function useConversationSubtasks(
  messages: UIMessage[]
): SubtaskCardItem[] {
  const subtasks = useMemo<SubtaskCardItem[]>(() => {
    const byId = new Map<string, SubtaskCardItem>()
    for (const message of messages) {
      if (message.role !== "assistant") continue
      for (const part of message.parts) {
        if (!isToolUIPart(part)) continue
        const vm = normalizeToolPart(part)
        if (vm.toolName !== "task") continue
        const input = (vm.input ?? {}) as Record<string, unknown>
        byId.set(vm.toolCallId, {
          toolCallId: vm.toolCallId,
          description: asString(input.description),
          subagentType: asString(input.subagent_type),
          state: vm.state,
          preliminary: vm.preliminary,
          output: vm.resultText,
        })
      }
    }
    return Array.from(byId.values())
  }, [messages])

  return subtasks
}

/**
 * 把聚合出的子任务写入 tasks-panel-store，让挂在 chat 布局里的合并任务面板
 * （无法直接拿到 messages）可以读取展示。仅在内容真正变化时写入。
 */
export function useSyncConversationSubtasks(messages: UIMessage[]): number {
  const subtasks = useConversationSubtasks(messages)
  const setSubtasks = useTasksPanelStore((s) => s.setSubtasks)

  useEffect(() => {
    setSubtasks(subtasks)
  }, [subtasks, setSubtasks])

  // 卸载（切走会话/切联系人）时清空，避免上一个会话的子任务残留到新会话面板。
  useEffect(() => {
    return () => {
      useTasksPanelStore.getState().setSubtasks([])
    }
  }, [])

  return subtasks.length
}
