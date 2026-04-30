import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { chatKeys } from "@/lib/query-keys/chat"
import { request } from "@/lib/request"
import type {
  EmployeeScheduleTask,
  MonthlyOverview,
  TaskExecution,
  TaskRun,
  TaskSummary,
  TodayTask,
} from "@/types/schedule-monitor"
import { generateAnomalies } from "@/lib/mock-data/schedule-monitor"

const WORKSPACE_ID = 1

function mapExecutionToTaskRun(exec: TaskExecution): TaskRun {
  return {
    id: String(exec.id),
    taskId: String(exec.task_id),
    taskName: exec.task_name,
    employeeId: String(exec.employee_id),
    cronExpression: "",
    cronDescription: "",
    status: exec.run_status,
    triggeredAt: exec.started_at,
    completedAt: exec.ended_at,
    duration: exec.duration_ms,
    result: exec.run_result,
    log: exec.error_message,
  }
}

export function useMonthlyScheduleOverview(
  year: number,
  month: number,
) {
  return useQuery({
    queryKey: [...chatKeys.all, "schedule-overview", year, month],
    queryFn: async () => {
      const res = await request<{ code: number; data: MonthlyOverview }>(
        `/tasks/calendar/monthly?year=${year}&month=${month}`
      )
      return res.data
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}

export function useTodayTaskRuns(employeeId: string | null) {
  return useQuery({
    queryKey: [...chatKeys.all, "today-task-runs", employeeId],
    queryFn: async () => {
      const res = await request<{
        code: number
        data: TaskExecution[]
      }>(
        `/workspaces/${WORKSPACE_ID}/tasks/executions?employee_id=${employeeId}`
      )
      return res.data.map(mapExecutionToTaskRun)
    },
    enabled: Boolean(employeeId),
    staleTime: 30_000,
  })
}

export function useTaskSummary(employeeId: string | null) {
  return useQuery({
    queryKey: [...chatKeys.all, "task-summary", employeeId],
    queryFn: async () => {
      const [scheduleRes, execRes] = await Promise.all([
        request<{
          code: number
          data: { date: string; skill_tasks: EmployeeScheduleTask[] }
        }>(`/employees/${employeeId}/tasks/schedule`),
        request<{
          code: number
          data: TaskExecution[]
        }>(
          `/workspaces/${WORKSPACE_ID}/tasks/executions?employee_id=${employeeId}`
        ),
      ])

      const scheduledTasks = scheduleRes.data.skill_tasks
      const executions = execRes.data

      const latestByTask = new Map<number, TaskExecution>()
      for (const exec of executions) {
        const existing = latestByTask.get(exec.task_id)
        if (
          !existing ||
          new Date(exec.started_at) > new Date(existing.started_at)
        ) {
          latestByTask.set(exec.task_id, exec)
        }
      }

      let completed = 0
      let failed = 0
      let pending = 0

      for (const task of scheduledTasks) {
        const latest = latestByTask.get(task.id)
        if (!latest) {
          pending++
          continue
        }
        if (latest.run_status === "success") {
          completed++
        } else if (
          latest.run_status === "failed" ||
          latest.run_status === "timeout"
        ) {
          failed++
        } else {
          pending++
        }
      }

      const summary: TaskSummary = {
        total: scheduledTasks.length,
        completed,
        failed,
        pending,
      }
      return summary
    },
    enabled: Boolean(employeeId),
    staleTime: 30_000,
  })
}

export function useAllTaskExecutions() {
  return useQuery({
    queryKey: [...chatKeys.all, "all-task-executions"],
    queryFn: async () => {
      const res = await request<{
        code: number
        data: TaskExecution[]
      }>(`/workspaces/${WORKSPACE_ID}/tasks/executions`)
      return res.data
    },
    staleTime: 30_000,
    refetchInterval: 15_000,
  })
}

export function useTodayAllExecutions() {
  return useQuery({
    queryKey: [...chatKeys.all, "today-all-executions"],
    queryFn: () =>
      request<{
        code: number
        data: TodayTask[]
      }>(`/workspaces/${WORKSPACE_ID}/tasks/today`)
        .then((res) => res.data),
    staleTime: 30_000,
  })
}

export function useAnomalies(employeeId: string | null) {
  return useQuery({
    queryKey: [...chatKeys.all, "anomalies", employeeId],
    queryFn: () => generateAnomalies(employeeId!),
    enabled: Boolean(employeeId),
    staleTime: 30_000,
  })
}

export function useNotifications() {
  return useQuery({
    queryKey: [...chatKeys.all, "notifications"],
    queryFn: async () => {
      const res = await request<{
        code: number
        data: TaskExecution[]
      }>(`/workspaces/${WORKSPACE_ID}/tasks/executions`)
      return res.data.filter((e) => e.confirm_execution_result)
    },
    staleTime: 30_000,
    refetchInterval: 15_000,
  })
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await request(`/workspaces/${WORKSPACE_ID}/tasks/executions/${id}/read`, { method: "POST" })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...chatKeys.all, "notifications"] })
    },
  })
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (ids: number[]) => {
      await Promise.all(
        ids.map((id) => request(`/workspaces/${WORKSPACE_ID}/tasks/executions/${id}/read`, { method: "POST" }))
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...chatKeys.all, "notifications"] })
    },
  })
}
