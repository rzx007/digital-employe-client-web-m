import { useEffect, useState } from "react"

import { useWorkspaceEvents } from "@/hooks/use-workspace-events"
import { useCuratorTaskExecutions } from "@/hooks/use-schedule-monitor-queries"
import type { TaskRunStatus } from "@/types/schedule-monitor"

export type PlanTaskStatus = "pending" | "running" | "success" | "failed"

/** 进度排序:用于「取更靠前者」合并,保证单调不回退。 */
const RANK: Record<PlanTaskStatus, number> = {
  pending: 0,
  running: 1,
  success: 2,
  failed: 2,
}

function mapRunStatus(s: TaskRunStatus): PlanTaskStatus {
  if (s === "success") return "success"
  if (s === "running" || s === "stuck") return "running"
  if (s === "queued" || s === "pending") return "pending"
  return "failed" // failed | timeout | cancelled
}

/** 取两个状态里更靠前(rank 更大)的那个;有一个为空则返回另一个。 */
function moreAdvanced(
  a: PlanTaskStatus | undefined,
  b: PlanTaskStatus | undefined
): PlanTaskStatus | undefined {
  if (a == null) return b
  if (b == null) return a
  return RANK[a] >= RANK[b] ? a : b
}

/**
 * 聚合某个编排计划下各子任务的实时执行状态。
 *
 * 数据源有两条,合并取「更靠前者」(单调不回退):
 *   1. **真实执行状态**(`useCuratorTaskExecutions`,DB 真值,随 task 事件 refetch)——
 *      用于 seed/对账:卡片**订阅前**就已完成/重挂载丢失的任务,从这里补回正确状态,
 *      不再永久卡在「待执行」。
 *   2. **live 事件**(`task_started/completed/failed`)——即时更新,无 refetch 延迟。
 *
 * 入参 taskIds 是该计划全部子任务 id(来自计划卡数据);conversationId 是计划所在的
 * 总管会话 id(用于按会话拉执行记录)。
 */
export function usePlanProgress(
  taskIds: number[],
  conversationId?: string | number | null
): {
  statusByTaskId: Record<number, PlanTaskStatus>
  completed: number
  total: number
} {
  const [liveStatus, setLiveStatus] = useState<Record<number, PlanTaskStatus>>(
    {}
  )

  // 切换计划(taskIds 变化)时清空旧 live 状态,避免上一个计划的进度残留。
  const key = taskIds
    .slice()
    .sort((a, b) => a - b)
    .join(",")
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLiveStatus({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useWorkspaceEvents((event) => {
    let taskId: number | null = null
    let next: PlanTaskStatus | null = null
    if (event.type === "task_started") {
      taskId = event.task_id
      next = "running"
    } else if (event.type === "task_completed") {
      taskId = event.task_id
      next = "success"
    } else if (event.type === "task_failed") {
      taskId = event.task_id
      next = "failed"
    }
    if (taskId == null || next == null) return
    if (!taskIds.includes(taskId)) return
    setLiveStatus((prev) => {
      // 单调不回退:晚到的 started 不能把已 completed 打回 running。
      const merged = moreAdvanced(prev[taskId!], next!)!
      if (prev[taskId!] === merged) return prev
      return { ...prev, [taskId!]: merged }
    })
  })

  // seed/对账:从真实执行记录按 task_id 取状态(漏掉的 live 事件由此补回)。
  const { data: executions = [] } = useCuratorTaskExecutions(
    conversationId ?? null
  )
  const taskIdSet = new Set(taskIds)
  const execStatus: Record<number, PlanTaskStatus> = {}
  for (const e of executions) {
    if (e.task_id != null && taskIdSet.has(e.task_id)) {
      execStatus[e.task_id] = moreAdvanced(
        execStatus[e.task_id],
        mapRunStatus(e.run_status)
      )!
    }
  }

  // 有效状态 = live 事件与执行真值里更靠前者;都无则 pending。
  const statusByTaskId: Record<number, PlanTaskStatus> = {}
  for (const id of taskIds) {
    statusByTaskId[id] =
      moreAdvanced(liveStatus[id], execStatus[id]) ?? "pending"
  }

  const total = taskIds.length
  const completed = taskIds.filter(
    (id) => statusByTaskId[id] === "success" || statusByTaskId[id] === "failed"
  ).length

  return { statusByTaskId, completed, total }
}
