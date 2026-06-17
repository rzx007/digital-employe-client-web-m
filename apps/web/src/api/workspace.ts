import { request } from "@/lib/request"
import type { ApiResponse } from "./types"

export interface WorkspaceData {
  id: number
  name: string
  root_path: string
  user_id: string | null
}

export async function getMyWorkspace(
  userId: string,
  username: string
): Promise<WorkspaceData> {
  const res = await request<{ data: WorkspaceData }>("/workspaces/my", {
    method: "POST",
    body: { user_id: userId, username },
  })
  return res.data
}

/**
 * 当前用户的工作空间列表
 * GET /workspaces
 */
export async function listWorkspaces(opts?: {
  signal?: AbortSignal
}): Promise<WorkspaceData[]> {
  const res = await request<ApiResponse<WorkspaceData[]>>("/workspaces", {
    ...(opts?.signal ? { signal: opts.signal } : {}),
  })
  return Array.isArray(res?.data) ? res.data : []
}

/**
 * 新建空项目（工作空间）
 * POST /workspaces
 */
export async function createWorkspace(
  name?: string,
  rootPath?: string
): Promise<WorkspaceData> {
  const body: Record<string, unknown> = {}
  if (name != null && name !== "") body.name = name
  if (rootPath != null && rootPath !== "") body.root_path = rootPath
  const res = await request<ApiResponse<WorkspaceData>>("/workspaces", {
    method: "POST",
    body,
  })
  return res.data
}

/**
 * 删除工作空间（归属校验由后端处理）
 * DELETE /workspaces/{id}
 */
export async function deleteWorkspace(id: number): Promise<void> {
  await request<ApiResponse<null>>(`/workspaces/${id}`, {
    method: "DELETE",
  })
}
