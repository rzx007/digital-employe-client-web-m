import { request } from "@/lib/request"
import type { ApiResponse } from "@/api/types"

export type GroupRoomMemberState = "ready" | "running" | "sleeping" | "done"

export interface GroupRoomMember {
  member_id: number
  employee_id: number | null
  employee_name: string | null
  role_in_room: "leader" | "worker"
  state: GroupRoomMemberState
  conversation_id: number | null
}

export interface GroupRoomState {
  room_id: number
  room_conversation_id: number
  chat_group_id: number | null
  status: string
  title: string | null
  members: GroupRoomMember[]
}

/**
 * 获取群会话对应的协作房间状态（成员 + 角色/状态）。
 * GET /chat/conversations/{conversation_id}/room
 */
export async function fetchGroupRoomState(
  conversationId: number | string,
  opts?: { signal?: AbortSignal }
): Promise<GroupRoomState | null> {
  const res = await request<ApiResponse<GroupRoomState>>(
    `/chat/conversations/${conversationId}/room`,
    { method: "GET", signal: opts?.signal }
  )
  return res?.data ?? null
}

export type DagNodeType = "user" | "leader" | "worker"
export type DagNodeState = "pending" | "running" | "done" | "failed"

export interface DagNode {
  id: string
  type: DagNodeType
  name: string
  employee_id?: number
  task: string
  state: DagNodeState
  artifacts: string[]
  /** 该子任务正在执行的员工会话 id（有则点成员可直达） */
  conversation_id?: number | null
}

export interface DagEdge {
  from: string
  to: string
}

export interface GroupRoomDag {
  has_dag: boolean
  room_id: number
  plan_id?: number
  nodes: DagNode[]
  edges: DagEdge[]
}

/**
 * 获取群协作 DAG 流程图（节点+边）。仅"组长统筹"模式有 DAG。
 * GET /chat/conversations/{conversation_id}/room/dag
 */
export async function fetchGroupRoomDag(
  conversationId: number | string,
  opts?: { signal?: AbortSignal }
): Promise<GroupRoomDag | null> {
  const res = await request<ApiResponse<GroupRoomDag>>(
    `/chat/conversations/${conversationId}/room/dag`,
    { method: "GET", signal: opts?.signal }
  )
  return res?.data ?? null
}

export interface RoomArtifact {
  name: string
  path: string
  type: string
  is_text: boolean
  content: string
}

/**
 * 读取群房间共享产物文件内容（弹窗预览）。
 * GET /chat/conversations/{conversation_id}/room/artifact?path=...
 */
export async function fetchRoomArtifact(
  conversationId: number | string,
  path: string,
  opts?: { signal?: AbortSignal }
): Promise<RoomArtifact | null> {
  const res = await request<ApiResponse<RoomArtifact>>(
    `/chat/conversations/${conversationId}/room/artifact`,
    { method: "GET", params: { path }, signal: opts?.signal }
  )
  return res?.data ?? null
}
