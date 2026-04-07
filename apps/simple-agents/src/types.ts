/**
 * Type Definitions - 类型定义文件
 *
 * 包含系统中所有共享的类型定义
 * 用于确保类型安全和代码可维护性
 */

// ============ 核心数据类型 ============

/**
 * 会话类型
 *
 * 对应数据库中的 sessions 表
 */
export type Session = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  metadata: string | null
  isArchived: boolean
}

/**
 * 消息类型
 *
 * 对应数据库中的 messages 表
 */
export type Message = {
  id: number
  sessionId: string
  role: "user" | "assistant" | "system" | "tool"
  content: string | null
  toolCalls: string | null
  toolResults: string | null
  tokenCount: number | null
  createdAt: string
}

/**
 * 文件产物类型
 *
 * 对应数据库中的 artifacts 表
 */
export type Artifact = {
  id: string
  sessionId: string
  filePath: string
  fileName: string
  fileSize: number
  mimeType: string
  description: string | null
  createdAt: string
}

// ============ 请求/响应类型 ============

/**
 * 创建会话的输入参数
 */
export type CreateSessionInput = {
  id?: string
  title?: string
  metadata?: Record<string, unknown>
}

/**
 * 更新会话的输入参数
 */
export type UpdateSessionInput = {
  title?: string
  metadata?: Record<string, unknown>
  isArchived?: boolean
}

/**
 * 发送消息的输入参数
 */
export type SendMessageInput = {
  message: string
}

/**
 * 会话列表查询参数
 */
export type ListSessionsQuery = {
  page?: number
  pageSize?: number
  includeArchived?: boolean
}

/**
 * 消息列表查询参数
 */
export type ListMessagesQuery = {
  page?: number
  pageSize?: number
  before?: number
}

/**
 * 分页结果类型
 */
export type PaginatedResult<T> = {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// ============ 流相关类型 ============

/**
 * 流任务状态
 *
 * 用于标识流式对话的当前状态
 */
export type StreamTaskStatus =
  | "pending" // 等待开始
  | "streaming" // 正在流式处理
  | "completed" // 已完成
  | "failed" // 失败
  | "cancelled" // 已取消

/**
 * 流任务类型
 *
 * 对应数据库中的 stream_tasks 表
 */
export type StreamTask = {
  id: string
  sessionId: string
  status: StreamTaskStatus
  content: string
  errorMessage: string | null
  messageId: number | null
  createdAt: string
  updatedAt: string
}

/**
 * 流事件类型
 *
 * 用于通过 SSE 向客户端推送事件
 *
 * 事件类型：
 * - stream_start: 流开始
 * - token: 模型逐 token 输出
 * - tool_start: 工具调用开始
 * - tool_end: 工具调用结束
 * - done: 流完成
 * - error: 流出错
 * - cancelled: 流取消
 */
export type StreamEvent =
  | { type: "stream_start"; streamId: string }
  | { type: "token"; content: string }
  | { type: "tool_start"; name: string; input?: unknown }
  | { type: "tool_end"; name: string; output?: string }
  | { type: "done"; messageId: number; streamId: string }
  | { type: "error"; message: string; streamId: string }
  | { type: "cancelled"; streamId: string }
