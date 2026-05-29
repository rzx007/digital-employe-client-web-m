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
