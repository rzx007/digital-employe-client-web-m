import { request } from "@/lib/request"
import type { ApiResponse, Group } from "./types"

/** 当前固定工作空间 ID */
const WORKSPACE_ID = 1

/**
 * 创建群聊参数
 */
export interface CreateGroupParams {
  /** 群聊名称 */
  name: string
  /** 参与员工 ID 列表 */
  employee_ids: number[]
}

/**
 * 创建群聊
 * POST /workspaces/{workspace_id}/groups
 */
export async function createGroup(params: CreateGroupParams) {
  return request<ApiResponse<Group>>(`/workspaces/${WORKSPACE_ID}/groups`, {
    method: "POST",
    body: params,
  })
}

/**
 * 查询群聊列表
 * GET /workspaces/{workspace_id}/groups
 */
export async function fetchGroups() {
  return request<ApiResponse<Group[]>>(`/workspaces/${WORKSPACE_ID}/groups`)
}

/**
 * 查询群聊详情
 * GET /groups/{group_id}
 */
export async function fetchGroupById(groupId: number | string) {
  return request<ApiResponse<Group>>(`/groups/${groupId}`)
}

/**
 * 删除群聊
 * DELETE /groups/{group_id}
 */
export async function deleteGroup(groupId: number | string) {
  return request<ApiResponse<null>>(`/groups/${groupId}`, {
    method: "DELETE",
  })
}
