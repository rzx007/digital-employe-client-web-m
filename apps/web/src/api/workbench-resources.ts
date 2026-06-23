import { request } from "@/lib/request"
import { getActiveWorkspaceId } from "@/lib/workspace-id"
import type { ApiResponse } from "@/api/types"

export interface WorkbenchResource {
  id: number
  workspace_id: number
  source: "employee_artifact" | "upload"
  src_path: string
  title: string
  added_by: string | null
  created_at: string
}

export interface WorkbenchResourceContent {
  path: string
  content: string
  artifact_type: string
  language: string | null
}

export async function listWorkbenchResources(): Promise<WorkbenchResource[]> {
  const res = await request<ApiResponse<WorkbenchResource[]>>(
    "/workbench-resources/list",
    { params: { workspace_id: getActiveWorkspaceId() } }
  )
  return res.data ?? []
}

export async function addWorkbenchResource(args: {
  src_path: string
  title?: string
}): Promise<WorkbenchResource> {
  const res = await request<ApiResponse<WorkbenchResource>>(
    "/workbench-resources/add",
    {
      method: "POST",
      body: { workspace_id: getActiveWorkspaceId(), ...args },
    }
  )
  return res.data
}

export async function uploadWorkbenchResource(
  file: File,
  title?: string
): Promise<WorkbenchResource> {
  const form = new FormData()
  form.append("workspace_id", String(getActiveWorkspaceId()))
  form.append("file", file)
  if (title) form.append("title", title)
  const res = await request<ApiResponse<WorkbenchResource>>(
    "/workbench-resources/upload",
    { method: "POST", body: form }
  )
  return res.data
}

export async function deleteWorkbenchResource(id: number): Promise<void> {
  await request<ApiResponse<unknown>>(`/workbench-resources/${id}`, {
    method: "DELETE",
    params: { workspace_id: getActiveWorkspaceId() },
  })
}

export async function fetchWorkbenchResourceContent(
  id: number,
  opts?: { signal?: AbortSignal }
): Promise<WorkbenchResourceContent> {
  const res = await request<ApiResponse<WorkbenchResourceContent>>(
    `/workbench-resources/${id}/content`,
    {
      params: { workspace_id: getActiveWorkspaceId() },
      ...(opts?.signal ? { signal: opts.signal } : {}),
    }
  )
  return res.data
}
