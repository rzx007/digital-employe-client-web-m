import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { chatKeys } from "@/lib/query-keys/chat"
import { request } from "@/lib/request"
import type {
  EmployeeScheduleTask,
  MonthlyOverview,
  TaskExecution,
  TaskRun,
  TaskSummary,
  TodayTask,
  ExecutionMetrics7d,
} from "@/types/schedule-monitor"

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
  employeeId?: string | number | null
) {
  const employeeKey =
    employeeId != null && employeeId !== "" ? String(employeeId) : null

  return useQuery({
    queryKey: [...chatKeys.all, "schedule-overview", year, month, employeeKey],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        year: String(year),
        month: String(month),
      })
      if (employeeKey) {
        params.set("employee_id", employeeKey)
      }
      const res = await request<{ code: number; data: MonthlyOverview }>(
        `/tasks/calendar/monthly?${params.toString()}`,
        { signal }
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
    queryFn: async ({ signal }) => {
      const res = await request<{
        code: number
        data: TaskExecution[]
      }>(
        `/workspaces/${WORKSPACE_ID}/tasks/executions?employee_id=${employeeId}`,
        { signal }
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
    queryFn: async ({ signal }) => {
      const [scheduleRes, execRes] = await Promise.all([
        request<{
          code: number
          data: { date: string; skill_tasks: EmployeeScheduleTask[] }
        }>(`/employees/${employeeId}/tasks/schedule`, { signal }),
        request<{
          code: number
          data: TaskExecution[]
        }>(
          `/workspaces/${WORKSPACE_ID}/tasks/executions?employee_id=${employeeId}`,
          { signal }
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
    queryFn: async ({ signal }) => {
      const res = await request<{
        code: number
        data: TaskExecution[]
      }>(`/workspaces/${WORKSPACE_ID}/tasks/executions`, { signal })
      return res.data
    },
    staleTime: 30_000,
    refetchInterval: 15_000,
  })
}

const CURATOR_EXECUTIONS_PAGE_SIZE = 100

/** 总管会话下发的编排任务执行记录（经 orchestrator_conversation_id 过滤） */
export function useCuratorTaskExecutions(
  conversationId: string | number | null | undefined
) {
  const id = conversationId != null ? String(conversationId) : null
  return useQuery({
    queryKey: chatKeys.curatorExecutions(id ?? "none"),
    queryFn: async ({ signal }) => {
      const res = await request<{
        code: number
        data: TaskExecution[]
      }>(
        `/workspaces/${WORKSPACE_ID}/tasks/executions?orchestrator_conversation_id=${id}&page_size=${CURATOR_EXECUTIONS_PAGE_SIZE}`,
        { signal }
      )
      return res.data ?? []
    },
    enabled: id != null,
    staleTime: 5_000,
    refetchInterval: 10_000,
  })
}

export function useTodayAllExecutions() {
  return useQuery({
    queryKey: [...chatKeys.all, "today-all-executions"],
    queryFn: ({ signal }) =>
      request<{
        code: number
        data: TodayTask[]
      }>(`/workspaces/${WORKSPACE_ID}/tasks/today`, { signal }).then(
        (res) => res.data
      ),
    staleTime: 5_000,
    refetchInterval: 10_000,
  })
}

export function useExecutionMetrics7d(employeeId: string | null, days = 7) {
  return useQuery({
    queryKey: [...chatKeys.all, "execution-metrics", employeeId, days],
    queryFn: async ({ signal }) => {
      const res = await request<{
        code: number
        data: ExecutionMetrics7d
      }>(
        `/workspaces/${WORKSPACE_ID}/employees/${employeeId}/tasks/execution-metrics?days=${days}`,
        { signal }
      )
      return res.data
    },
    enabled: Boolean(employeeId),
    staleTime: 30_000,
  })
}

export function useNotifications() {
  return useQuery({
    queryKey: [...chatKeys.all, "notifications"],
    queryFn: async ({ signal }) => {
      const res = await request<{
        code: number
        data: TaskExecution[]
      }>(`/workspaces/${WORKSPACE_ID}/tasks/executions`, { signal })
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
      await request(`/workspaces/${WORKSPACE_ID}/tasks/executions/${id}/read`, {
        method: "POST",
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [...chatKeys.all, "notifications"],
      })
    },
  })
}

/**
 * 中止运行中的任务执行（终止会话流并标记 cancelled）。
 * 其依赖的后续任务将由编排 DAG 一并跳过。成功后刷新该总管会话的执行快照。
 */
export function useCancelTaskExecution(
  curatorConversationId: string | number | null | undefined
) {
  const queryClient = useQueryClient()
  const id =
    curatorConversationId != null ? String(curatorConversationId) : null
  return useMutation({
    mutationFn: async (executionLogId: number) => {
      await request(
        `/workspaces/${WORKSPACE_ID}/tasks/executions/${executionLogId}/cancel`,
        { method: "POST" }
      )
    },
    onSuccess: () => {
      if (id != null) {
        queryClient.invalidateQueries({
          queryKey: chatKeys.curatorExecutions(id),
        })
      }
    },
  })
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (ids: number[]) => {
      await Promise.all(
        ids.map((id) =>
          request(`/workspaces/${WORKSPACE_ID}/tasks/executions/${id}/read`, {
            method: "POST",
          })
        )
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [...chatKeys.all, "notifications"],
      })
    },
  })
}
