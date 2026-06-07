import { useEffect, useState } from "react"

import { useWorkspaceEvents } from "@/hooks/use-workspace-events"

export type PlanTaskStatus = "pending" | "running" | "success" | "failed"

/**
 * 聚合某个编排计划下各子任务的实时执行状态。
 *
 * 后端通过 WorkspaceEventBus 推送 task_started / task_completed / task_failed
 * （task_id = EmployeeTask.id，与 plan_generated 的 tasks[].task_id 同源）。
 * 本 hook 只监听这些事件、按 task_id 累积状态，供 TaskProgressBar 渲染——
 * 不拉接口、不动后端，纯前端聚合。
 *
 * 入参 taskIds 是该计划的全部子任务 id（来自计划卡已有数据），用于：
 *   1. 过滤掉不属于本计划的事件；
 *   2. 计算 total（completed/total 进度）。
 *
 * 返回 status 映射 + completed 计数；task 缺省视为 pending。
 */
export function usePlanProgress(taskIds: number[]): {
  statusByTaskId: Record<number, PlanTaskStatus>
  completed: number
  total: number
} {
  const [statusByTaskId, setStatusByTaskId] = useState<
    Record<number, PlanTaskStatus>
  >({})

  // 切换计划（taskIds 变化）时清空旧状态，避免上一个计划的进度残留。
  const key = taskIds.slice().sort((a, b) => a - b).join(",")
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatusByTaskId({})
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
    // 只接受本计划的子任务事件
    if (!taskIds.includes(taskId)) return
    setStatusByTaskId((prev) => {
      if (prev[taskId!] === next) return prev
      return { ...prev, [taskId!]: next! }
    })
  })

  const total = taskIds.length
  const completed = Object.values(statusByTaskId).filter(
    (s) => s === "success" || s === "failed"
  ).length

  return { statusByTaskId, completed, total }
}
