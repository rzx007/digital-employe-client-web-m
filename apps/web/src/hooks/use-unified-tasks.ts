import { useMemo } from "react"

import { useCuratorTaskExecutions } from "@/hooks/use-schedule-monitor-queries"
import { useShellExecutions } from "@/hooks/use-shell-executions"
import {
  countRunning,
  mergeUnifiedTasks,
  type UnifiedTaskItem,
} from "@/lib/chat/unified-tasks"
import { useTasksPanelStore } from "@/stores/tasks-panel-store"

/**
 * 合并当前会话的三类任务（子任务 + 后台命令 + 员工任务）成单一时间线。
 * 子任务来自 tasks-panel-store（消息流聚合），命令 / 员工任务走各自 API hook
 * （react-query 按 queryKey 去重，多处调用共享同一份数据与轮询）。
 */
export function useUnifiedTasks(
  conversationId: string | number | null | undefined
): UnifiedTaskItem[] {
  const subtasks = useTasksPanelStore((s) => s.subtasks)
  const { data: shells = [] } = useShellExecutions(conversationId)
  const { data: employees = [] } = useCuratorTaskExecutions(conversationId)

  return useMemo(
    () => mergeUnifiedTasks({ subtasks, shells, employees }),
    [subtasks, shells, employees]
  )
}

/** 当前会话三类任务中进行中的总数——统一入口角标 / 内联指示器共用。 */
export function useUnifiedRunningCount(
  conversationId: string | number | null | undefined
): number {
  const items = useUnifiedTasks(conversationId)
  return useMemo(() => countRunning(items), [items])
}
