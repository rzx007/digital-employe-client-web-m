import { request } from "@/lib/request"
import { getActiveWorkspaceId } from "@/lib/workspace-id"
import type { ApiResponse } from "./types"
import type { ChatTargetType } from "./types"

export interface RecentContactDto {
  target_type: ChatTargetType
  target_id: number
  contact_id: string
  contact_name: string
  title: string
  last_message?: string | null
  last_message_time?: string | null
  unread_count: number
  updated_at: string
  is_group: boolean
  is_curator: boolean
  is_pinned: boolean
  latest_conversation_id?: number | null
  status?: string | null
}

export interface RecentContactTouchParams {
  target_type: ChatTargetType
  target_id: number
}

export interface RecentContactImportItem {
  target_type: ChatTargetType
  target_id: number
  is_pinned?: boolean
  last_accessed_at?: string
}

type RecentContactsRequestOpts = {
  signal?: AbortSignal
  workspaceId?: number
}

function resolveWorkspaceId(workspaceId?: number): number {
  return workspaceId ?? getActiveWorkspaceId()
}

export async function fetchRecentContacts(opts?: RecentContactsRequestOpts) {
  const workspaceId = resolveWorkspaceId(opts?.workspaceId)
  return request<ApiResponse<RecentContactDto[]>>(
    `/workspaces/${workspaceId}/chat/recent-contacts`,
    opts?.signal ? { signal: opts.signal } : undefined
  )
}

export async function touchRecentContact(
  params: RecentContactTouchParams,
  opts?: RecentContactsRequestOpts
) {
  const workspaceId = resolveWorkspaceId(opts?.workspaceId)
  return request<ApiResponse<RecentContactDto>>(
    `/workspaces/${workspaceId}/chat/recent-contacts`,
    {
      method: "PUT",
      body: params,
      ...(opts?.signal ? { signal: opts.signal } : {}),
    }
  )
}

export async function updateRecentContactPin(
  targetType: ChatTargetType,
  targetId: number,
  isPinned: boolean,
  opts?: RecentContactsRequestOpts
) {
  const workspaceId = resolveWorkspaceId(opts?.workspaceId)
  return request<ApiResponse<RecentContactDto>>(
    `/workspaces/${workspaceId}/chat/recent-contacts/${targetType}/${targetId}`,
    {
      method: "PATCH",
      body: { is_pinned: isPinned },
      ...(opts?.signal ? { signal: opts.signal } : {}),
    }
  )
}

export async function deleteRecentContact(
  targetType: ChatTargetType,
  targetId: number,
  opts?: RecentContactsRequestOpts
) {
  const workspaceId = resolveWorkspaceId(opts?.workspaceId)
  return request<ApiResponse<null>>(
    `/workspaces/${workspaceId}/chat/recent-contacts/${targetType}/${targetId}`,
    {
      method: "DELETE",
      ...(opts?.signal ? { signal: opts.signal } : {}),
    }
  )
}

export async function importRecentContacts(
  items: RecentContactImportItem[],
  opts?: RecentContactsRequestOpts
) {
  const workspaceId = resolveWorkspaceId(opts?.workspaceId)
  return request<ApiResponse<{ imported_count: number }>>(
    `/workspaces/${workspaceId}/chat/recent-contacts/import`,
    {
      method: "POST",
      body: { items },
      ...(opts?.signal ? { signal: opts.signal } : {}),
    }
  )
}
