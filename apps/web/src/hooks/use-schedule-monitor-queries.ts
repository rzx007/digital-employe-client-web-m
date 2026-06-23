import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { chatKeys } from "@/lib/query-keys/chat"
import { request } from "@/lib/request"
import { getActiveWorkspaceId } from "@/lib/workspace-id"
import type {
  ExecutionMetrics7d,
  MonthlyOverview,
  TaskExecution,
  TaskRun,
  TodayTask,
  ToolFootprint,
} from "@/types/schedule-monitor"

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
  const workspaceId = getActiveWorkspaceId()

  return useQuery({
    queryKey: [
      ...chatKeys.all,
      "schedule-overview",
      workspaceId,
      year,
      month,
      employeeKey,
    ],
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
  const workspaceId = getActiveWorkspaceId()
  return useQuery({
    queryKey: [...chatKeys.all, "today-task-runs", workspaceId, employeeId],
    queryFn: async ({ signal }) => {
      const res = await request<{
        code: number
        data: TaskExecution[]
      }>(
        `/workspaces/${workspaceId}/tasks/executions?employee_id=${employeeId}`,
        { signal }
      )
      return res.data.map(mapExecutionToTaskRun)
    },
    enabled: Boolean(employeeId),
    staleTime: 30_000,
  })
}

export function useAllTaskExecutions() {
  const workspaceId = getActiveWorkspaceId()
  return useQuery({
    queryKey: [...chatKeys.all, "all-task-executions", workspaceId],
    queryFn: async ({ signal }) => {
      const res = await request<{
        code: number
        data: TaskExecution[]
      }>(`/workspaces/${workspaceId}/tasks/executions`, { signal })
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
        `/workspaces/${getActiveWorkspaceId()}/tasks/executions?orchestrator_conversation_id=${id}&page_size=${CURATOR_EXECUTIONS_PAGE_SIZE}`,
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
  const workspaceId = getActiveWorkspaceId()
  return useQuery({
    queryKey: [...chatKeys.all, "today-all-executions", workspaceId],
    queryFn: ({ signal }) =>
      request<{
        code: number
        data: TodayTask[]
      }>(`/workspaces/${workspaceId}/tasks/today`, { signal }).then(
        (res) => res.data
      ),
    staleTime: 5_000,
    refetchInterval: 10_000,
  })
}

export function useExecutionMetrics7d(employeeId: string | null, days = 7) {
  const workspaceId = getActiveWorkspaceId()
  return useQuery({
    queryKey: [
      ...chatKeys.all,
      "execution-metrics",
      workspaceId,
      employeeId,
      days,
    ],
    queryFn: async ({ signal }) => {
      const res = await request<{
        code: number
        data: ExecutionMetrics7d
      }>(
        `/workspaces/${workspaceId}/employees/${employeeId}/tasks/execution-metrics?days=${days}`,
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
      }>(`/workspaces/${getActiveWorkspaceId()}/tasks/executions`, { signal })
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
      await request(
        `/workspaces/${getActiveWorkspaceId()}/tasks/executions/${id}/read`,
        {
          method: "POST",
        }
      )
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
        `/workspaces/${getActiveWorkspaceId()}/tasks/executions/${executionLogId}/cancel`,
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
          request(
            `/workspaces/${getActiveWorkspaceId()}/tasks/executions/${id}/read`,
            {
              method: "POST",
            }
          )
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

/** 执行的工具足迹(事后,会话级)。enabled 受卡片展开态控制——点开才取一次。 */
export function useToolFootprint(
  executionLogId: number | null | undefined,
  opts?: { enabled?: boolean }
) {
  return useQuery({
    // 不含 workspaceId：executionLogId 全局唯一，且按前缀失效
    queryKey: [...chatKeys.all, "tool-footprint", executionLogId ?? "none"],
    queryFn: async ({ signal }) => {
      const res = await request<{ code: number; data: ToolFootprint }>(
        `/workspaces/${getActiveWorkspaceId()}/tasks/executions/${executionLogId}/tool-footprint`,
        { signal }
      )
      return res.data
    },
    enabled: (opts?.enabled ?? false) && executionLogId != null,
    staleTime: 60_000,
  })
}
