import { request } from "@/lib/request"
import type {
  ApiResponse,
  ChatMessage,
  ConversationItem,
  ConversationQuery,
  CreateConversationParams,
  ResourceContent,
  ResourceList,
  ResourceUploadResult,
} from "./types"

/** 当前固定工作空间 ID */
const WORKSPACE_ID = 1

/**
 * 创建聊天会话
 * POST /workspaces/{workspace_id}/chat/conversations
 */
export async function createConversation(params: CreateConversationParams) {
  return request<ApiResponse<ConversationItem>>(
    `/workspaces/${WORKSPACE_ID}/chat/conversations`,
    {
      method: "POST",
      body: params,
    }
  )
}

/**
 * 查询聊天会话列表
 * GET /workspaces/{workspace_id}/chat/conversations
 */
export async function fetchConversations(
  query?: ConversationQuery,
  opts?: { signal?: AbortSignal }
) {
  return request<ApiResponse<ConversationItem[]>>(
    `/workspaces/${WORKSPACE_ID}/chat/conversations`,
    {
      params: query,
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
  return request<ApiResponse<ChatMessage[]>>(
    `/chat/conversations/${conversationId}/messages`,
    opts?.signal ? { signal: opts.signal } : undefined
  )
}
export async function deleteConversation(conversationId: number | string) {
  return request<ApiResponse<null>>(`/chat/conversations/${conversationId}`, {
    method: "DELETE",
  })
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
  return request<ApiResponse<ConversationItem>>(
    `/workspaces/${WORKSPACE_ID}/chat/curator/conversation`,
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
    `/workspaces/${WORKSPACE_ID}/tasks/executions`,
    { method: "DELETE" }
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
  messageId: number | string,
  decisions: HitlDecision[]
) {
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
      message_id: Number(messageId),
      decisions,
    }),
  })
}
