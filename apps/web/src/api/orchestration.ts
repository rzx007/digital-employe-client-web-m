import { request } from "@/lib/request"
import { getActiveWorkspaceId } from "@/lib/workspace-id"

function resolveWorkspaceId(workspaceId?: number): number {
  return workspaceId ?? getActiveWorkspaceId()
}

function isApiSuccess(code: number): boolean {
  return code === 200 || code === 0
}

export async function confirmOrchestrationPlan(
  planId: number,
  workspaceId?: number
): Promise<{ plan_id: number; status: string; result?: string }> {
  const wsId = resolveWorkspaceId(workspaceId)
  const res = await request<{
    code: number
    msg: string
    data: { plan_id: number; status: string; result?: string } | null
  }>(`/workspaces/${wsId}/orchestration/plans/${planId}/confirm`, {
    method: "PUT",
  })
  if (!isApiSuccess(res.code) || !res.data) {
    throw new Error(res.msg || "确认编排计划失败")
  }
  return res.data
}

export async function cancelOrchestrationPlan(
  planId: number,
  workspaceId?: number
): Promise<{ plan_id: number; status: string }> {
  const wsId = resolveWorkspaceId(workspaceId)
  const res = await request<{
    code: number
    msg: string
    data: { plan_id: number; status: string } | null
  }>(`/workspaces/${wsId}/orchestration/plans/${planId}/cancel`, {
    method: "PUT",
  })
  if (!isApiSuccess(res.code) || !res.data) {
    throw new Error(res.msg || "取消编排计划失败")
  }
  return res.data
}

export interface OrchestrationPlanTaskDetail {
  task_id: number
  employee_id: number
  employee_name: string
  task_name: string
  prompt: string
  cron?: string | null
  execute_mode?: string
  status?: string
}

/** GET /orchestration/plans/{plan_id} — 拉取计划实时子任务（含 prompt/employee_id 供编辑）。 */
export async function fetchOrchestrationPlanDetail(
  planId: number,
  opts?: { signal?: AbortSignal }
): Promise<OrchestrationPlanTaskDetail[]> {
  const res = await request<{
    code: number
    msg: string
    data: { tasks?: OrchestrationPlanTaskDetail[] } | null
  }>(
    `/orchestration/plans/${planId}`,
    opts?.signal ? { signal: opts.signal } : {}
  )
  if (!isApiSuccess(res.code) || !res.data) {
    throw new Error(res.msg || "获取编排计划详情失败")
  }
  return res.data.tasks ?? []
}

/** PUT 编辑待确认计划的子任务（仅 prompt / 换员工，confirm 前可改）。 */
export async function updateOrchestrationPlanTask(
  planId: number,
  taskId: number,
  body: { prompt?: string; employee_id?: number },
  workspaceId?: number
): Promise<{
  task_id: number
  employee_id: number
  employee_name: string
  prompt: string
}> {
  const wsId = resolveWorkspaceId(workspaceId)
  const res = await request<{
    code: number
    msg: string
    data: {
      task_id: number
      employee_id: number
      employee_name: string
      prompt: string
    } | null
  }>(`/workspaces/${wsId}/orchestration/plans/${planId}/tasks/${taskId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  })
  if (!isApiSuccess(res.code) || !res.data) {
    throw new Error(res.msg || "编辑子任务失败")
  }
  return res.data
}
