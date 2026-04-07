import { request } from "@/lib/request"
import type {
  ApiResponse,
  ChatMessage,
  ConversationItem,
  ConversationQuery,
  CreateConversationParams,
} from "./types"

/** 当前固定工作空间 ID */
const WORKSPACE_ID = 1

/**
 * 创建聊天会话
 * POST /chat/conversations
 */
export async function createConversation(params: CreateConversationParams) {
  return request<ApiResponse<ConversationItem>>(`/chat/conversations`, {
    method: "POST",
    body: {
      workspace_id: WORKSPACE_ID,
      ...params,
    },
  })
}

/**
 * 查询聊天会话列表
 * GET /chat/conversations
 */
export async function fetchConversations(query?: ConversationQuery) {
  return request<ApiResponse<ConversationItem[]>>(`/chat/conversations`, {
    params: {
      workspace_id: WORKSPACE_ID,
      ...query,
    },
  })
}

/**
 * 查询会话消息记录
 * GET /chat/conversations/{conversation_id}/messages
 */
export async function fetchConversationMessages(
  conversationId: number | string
) {
  return request<ApiResponse<ChatMessage[]>>(
    `/chat/conversations/${conversationId}/messages`
  )
}

export async function deleteConversation(conversationId: number | string) {
  return request<ApiResponse<null>>(`/chat/conversations/${conversationId}`, {
    method: "DELETE",
  })
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
