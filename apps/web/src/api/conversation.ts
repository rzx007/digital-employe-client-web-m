import { request } from "@/lib/request"
import { getActiveWorkspaceId } from "@/lib/workspace-id"
import { useAuthStore } from "@/stores/auth-store"
import type { DbMessageId } from "@/lib/chat/hitl/message-id"
import type {
  ApiResponse,
  ChatMessageDto,
  ConversationListItemDto,
  ConversationQuery,
  CreateConversationParams,
  ResourceContent,
  ResourceList,
  ResourceUploadResult,
} from "./types"

/**
 * 创建聊天会话
 * POST /workspaces/{workspace_id}/chat/conversations
 */
export async function createConversation(params: CreateConversationParams) {
  return request<ApiResponse<ConversationListItemDto>>(
    `/workspaces/${getActiveWorkspaceId()}/chat/conversations`,
    {
      method: "POST",
      body: params,
    }
  )
}

export async function updateConversationTitle(
  conversationId: number | string,
  title: string
) {
  return request<ApiResponse<ConversationListItemDto>>(
    `/chat/conversations/${conversationId}`,
    {
      method: "PATCH",
      body: { title },
    }
  )
}

export async function suggestConversationTitle(
  message: string,
  opts?: { signal?: AbortSignal }
) {
  return request<
    ApiResponse<{ title: string; source: "rule" | "llm" | "fallback" }>
  >("/chat/conversations/suggest-title", {
    method: "POST",
    body: { message },
    ...(opts?.signal ? { signal: opts.signal } : {}),
  })
}

/**
 * 查询聊天会话列表
 * GET /workspaces/{workspace_id}/chat/conversations
 */
export async function fetchConversations(
  query?: ConversationQuery,
  opts?: { signal?: AbortSignal }
) {
  return request<ApiResponse<ConversationListItemDto[]>>(
    `/workspaces/${getActiveWorkspaceId()}/chat/conversations`,
    {
      params: query,
      ...(opts?.signal ? { signal: opts.signal } : {}),
    }
  )
}

/**
 * 查询当前用户跨项目的会话列表（用户级，每项带 workspace_id 标识所属项目）
 * GET /chat/conversations?target_type=
 */
export async function listUserConversations(
  targetType?: string,
  opts?: { signal?: AbortSignal }
) {
  return request<ApiResponse<ConversationListItemDto[]>>(
    "/chat/conversations",
    {
      params: targetType ? { target_type: targetType } : undefined,
      ...(opts?.signal ? { signal: opts.signal } : {}),
    }
  )
}

/**
 * 查询会话消息记录
 * GET /chat/conversations/{conversation_id}/messages
 */
export async function fetchConversationMessages(
  conversationId: number | string,
  opts?: { signal?: AbortSignal }
) {
  return request<ApiResponse<ChatMessageDto[]>>(
    `/chat/conversations/${conversationId}/messages`,
    opts?.signal ? { signal: opts.signal } : undefined
  )
}

export async function fetchConversationContextBudget(
  conversationId: number | string,
  opts?: { signal?: AbortSignal }
) {
  return request<
    ApiResponse<import("@/lib/chat/context-budget").ContextBudgetSnapshot>
  >(
    `/chat/conversations/${conversationId}/context-budget`,
    opts?.signal ? { signal: opts.signal } : undefined
  )
}
export async function deleteConversation(
  conversationId: number | string,
  cascade = true
) {
  return request<ApiResponse<null>>(`/chat/conversations/${conversationId}`, {
    method: "DELETE",
    params: { cascade },
  })
}

export interface ConversationsBulkDeleteResult {
  deleted_count: number
  deleted_ids: number[]
}

/**
 * 按联系人批量删除会话
 * DELETE /workspaces/{workspace_id}/chat/conversations?target_type=&target_id=
 */
export async function deleteConversationsByTarget(
  query: { target_type: string; target_id: number; cascade?: boolean },
  opts?: { signal?: AbortSignal }
) {
  return request<ApiResponse<ConversationsBulkDeleteResult>>(
    `/workspaces/${getActiveWorkspaceId()}/chat/conversations`,
    {
      method: "DELETE",
      params: { cascade: true, ...query },
      ...(opts?.signal ? { signal: opts.signal } : {}),
    }
  )
}
export async function deleteConversationUpload(
  conversationId: number | string,
  path: string
) {
  return request<ApiResponse<null>>(
    `/chat/conversations/${conversationId}/resources/uploads?path=${encodeURIComponent(path)}`,
    {
      method: "DELETE",
    }
  )
}

/**
 * 流式对话（SSE）
 * GET /chat/conversations/{conversation_id}/stream
 * 返回原始 Response 对象，用于读取 Server-Sent Events 流
 */
export async function streamConversation(
  conversationId: number | string,
  question: string
) {
  return request.raw(`/chat/conversations/${conversationId}/stream`, {
    params: { question },
  })
}

/**
 * 手动终止正在执行的会话流
 * POST /chat/conversations/{conversation_id}/stream/cancel
 */
export async function cancelConversationStream(
  conversationId: number | string
) {
  return request<ApiResponse<null>>(
    `/chat/conversations/${conversationId}/stream/cancel`,
    {
      method: "POST",
    }
  )
}

export async function fetchConversationResources(
  conversationId: number | string,
  opts?: { signal?: AbortSignal }
) {
  return request<ApiResponse<ResourceList>>(
    `/chat/conversations/${conversationId}/resources`,
    opts?.signal ? { signal: opts.signal } : undefined
  )
}

export async function fetchCuratorConversation(opts?: {
  signal?: AbortSignal
}) {
  return request<ApiResponse<ConversationListItemDto>>(
    `/workspaces/${getActiveWorkspaceId()}/chat/curator/conversation`,
    opts?.signal ? { signal: opts.signal } : undefined
  )
}

export async function fetchResourceContent(
  conversationId: number | string,
  path: string,
  opts?: { signal?: AbortSignal }
) {
  return request<ApiResponse<ResourceContent>>(
    `/chat/conversations/${conversationId}/resources/content`,
    {
      params: { path },
      ...(opts?.signal ? { signal: opts.signal } : {}),
    }
  )
}

export async function deleteAllTaskExecutions() {
  return request<ApiResponse<{ deleted: number }>>(
    `/workspaces/${getActiveWorkspaceId()}/tasks/executions`,
    { method: "DELETE" }
  )
}

/** 仅删除指定总管会话关联的执行日志（阶段三：清空单条总管会话） */
export async function deleteTaskExecutionsByOrchestratorConversation(
  orchestratorConversationId: number | string
) {
  return request<ApiResponse<{ deleted: number }>>(
    `/workspaces/${getActiveWorkspaceId()}/tasks/executions`,
    {
      method: "DELETE",
      params: {
        orchestrator_conversation_id: orchestratorConversationId,
      },
    }
  )
}

export async function uploadConversationFile(
  conversationId: number | string,
  file: File
) {
  const formData = new FormData()
  formData.append("file", file)
  return request<ApiResponse<ResourceUploadResult>>(
    `/chat/conversations/${conversationId}/resources/upload`,
    {
      method: "POST",
      body: formData,
    }
  )
}

export async function downloadResource(
  conversationId: number | string,
  path: string
) {
  const res = await request.raw(
    `/chat/conversations/${conversationId}/resources/download`,
    { params: { path }, responseType: "blob" }
  )
  const raw = res._data
  if (raw == null) {
    throw new Error("下载失败：响应体为空")
  }
  const blob = raw instanceof Blob ? raw : new Blob([raw])

  const disposition = res.headers.get("content-disposition")
  const filename =
    disposition?.match(/filename="(.+?)"/)?.[1] ??
    path.replace(/\/$/, "").split("/").pop() ??
    "download"

  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export async function downloadResourceBlob(
  conversationId: number | string,
  path: string
): Promise<Blob> {
  const res = await request.raw(
    `/chat/conversations/${conversationId}/resources/download`,
    { params: { path }, responseType: "blob" }
  )
  const raw = res._data
  if (raw == null) {
    throw new Error("下载失败：响应体为空")
  }
  return raw instanceof Blob ? raw : new Blob([raw])
}

export async function deleteResource(
  conversationId: number | string,
  path: string
) {
  return request<ApiResponse<null>>(
    `/chat/conversations/${conversationId}/resources?path=${encodeURIComponent(path)}`,
    { method: "DELETE" }
  )
}

export interface BatchDeleteResult {
  deleted: string[]
  skipped: string[]
}

/** 批量删产物：逐条沙箱校验，返回 {deleted, skipped} */
export async function batchDeleteResources(
  conversationId: number | string,
  paths: string[]
) {
  return request<ApiResponse<BatchDeleteResult>>(
    `/chat/conversations/${conversationId}/resources/batch-delete`,
    { method: "POST", body: JSON.stringify({ paths }) }
  )
}

export async function resetConversationStatus(conversationId: number | string) {
  return request<ApiResponse<null>>(
    `/chat/conversations/${conversationId}/status/reset`,
    { method: "POST" }
  )
}

export type HitlDecision =
  | { type: "approve" }
  | { type: "reject"; message: string }
  | { type: "respond"; message: string }
  | {
      type: "edit"
      edited_action: { name: string; args: Record<string, unknown> }
    }

export async function approveHitl(
  conversationId: number | string,
  messageId: DbMessageId,
  decisions: HitlDecision[],
  options?: {
    destructive_hitl?: { skip_for_conversation?: boolean }
  }
) {
  const dbId = Number(messageId)
  if (!Number.isFinite(dbId) || dbId <= 0) {
    throw new Error(`Invalid approve message_id: ${String(messageId)}`)
  }
  return request<
    ApiResponse<{
      accepted?: boolean
      resumed?: boolean
      assistant_message_id?: number
      approved_message_id?: number
    }>
  >(`/chat/conversations/${conversationId}/approve`, {
    method: "POST",
    body: JSON.stringify({
      message_id: dbId,
      decisions,
      ...(options?.destructive_hitl
        ? { destructive_hitl: options.destructive_hitl }
        : {}),
    }),
  })
}

export interface BugFeedbackInput {
  title?: string
  description?: string
  repro_steps?: string
  expected?: string
  actual?: string
  include_logs?: boolean
  /** 上报人用户ID/名（提交时自动从登录态带入；远端按此识别上报人） */
  reporter_id?: number
  reporter_name?: string
  /** 截图 base64 dataURI；直接发往后台、不经模型上下文 */
  screenshot?: string
}

export interface BugFeedbackResult {
  ok: boolean
  message?: string
  remote?: unknown
}

/**
 * BUG 反馈表单直接提交：浏览器 → 本地 /feedback → 远端后台。
 * 截图随此请求一起发送，**绝不经过模型/HITL 上下文**（避免图片撑爆上下文）。
 */
export async function submitBugFeedback(
  payload: BugFeedbackInput
): Promise<BugFeedbackResult> {
  // 自动带入登录用户作为上报人（远端 actus 无法解码 token，故由客户端提供身份）
  const user = useAuthStore.getState().user
  const body: BugFeedbackInput = {
    ...payload,
    reporter_id: payload.reporter_id ?? user?.id,
    reporter_name: payload.reporter_name ?? user?.name,
  }
  return request<BugFeedbackResult>("/feedback", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export async function uploadVoiceAudio(
  conversationId: number | string,
  blob: Blob
) {
  const formData = new FormData()
  formData.append("file", blob, "recording.webm")
  return request<ApiResponse<{ audio_path: string }>>(
    `/chat/conversations/${conversationId}/voice/upload`,
    {
      method: "POST",
      body: formData,
    }
  )
}

export async function fetchVoiceAudioBlob(
  conversationId: number | string,
  path: string
): Promise<Blob> {
  const res = await request.raw(
    `/chat/conversations/${conversationId}/voice/audio`,
    { params: { path }, responseType: "blob" }
  )
  const raw = res._data
  if (raw == null) {
    throw new Error("语音文件不存在")
  }
  return raw instanceof Blob ? raw : new Blob([raw])
}
