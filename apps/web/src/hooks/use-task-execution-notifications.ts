import * as React from "react"
import { useAllTaskExecutions } from "./use-schedule-monitor-queries"
import type { TaskExecution, TaskRunStatus } from "@/types/schedule-monitor"
import { getElectronApi } from "@/lib/electron/host"

const TERMINAL_STATUSES = new Set<TaskRunStatus>([
  "success",
  "failed",
  "timeout",
  "cancelled",
])

const STATUS_TEXT: Record<string, string> = {
  success: "执行成功",
  failed: "执行失败",
  timeout: "执行超时",
  cancelled: "已取消",
}

const RECENT_THRESHOLD_MS = 30_000

function isTerminal(status: TaskRunStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

export function useTaskExecutionNotifications() {
  const { data: executions = [] } = useAllTaskExecutions()
  const prevStatusMapRef = React.useRef<Map<number, TaskRunStatus>>(new Map())

  React.useEffect(() => {
    const prevMap = prevStatusMapRef.current
    const nextMap = new Map<number, TaskRunStatus>()
    const now = Date.now()
    const newlyCompleted: TaskExecution[] = []

    for (const exec of executions) {
      nextMap.set(exec.id, exec.run_status)

      if (!isTerminal(exec.run_status)) continue

      const prevStatus = prevMap.get(exec.id)

      const isNewlyTerminal = prevMap.size === 0
        ? false
        : prevStatus === undefined || !isTerminal(prevStatus)

      if (!isNewlyTerminal) continue

      const endedAt = exec.ended_at ? new Date(exec.ended_at).getTime() : 0
      if (endedAt > 0 && now - endedAt > RECENT_THRESHOLD_MS) continue

      newlyCompleted.push(exec)
    }

    prevStatusMapRef.current = nextMap

    if (newlyCompleted.length === 0) return
    const api = getElectronApi()
    if (!api?.sendNotification) return

    for (const exec of newlyCompleted) {
      const title = `${exec.employee_name} · ${exec.task_name}`
      const body = exec.run_result
        || STATUS_TEXT[exec.run_status]
        || "任务执行完成"
      api.sendNotification(title, body, false)
    }
  }, [executions])
}
