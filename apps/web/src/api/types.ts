/**
 * 统一 API 响应结构
 */
export interface ApiResponse<T> {
  code: number
  msg: string
  data: T
}

/**
 * 员工能力项
 */
export interface Capability {
  capability_name: string
  capability_desc: string
  mcp_server_name: string
  mcp_tool_name: string
}

/**
 * 员工技能（metadata.skills 中的项）
 */
export interface MetadataSkill {
  id: number
  skillName: string
  description: string
  prompt: string
  directoryId: number | null
  status: number
  createTime: string
  updateTime: string
  directoryName: string | null
}

/**
 * 员工元数据（能力描述、MCP 工具绑定等）
 */
export interface EmployeeMetadata {
  employee_name: string
  status: number
  capability_desc: string
  detail_page_url: string | null
  user_id: string
  created_at: string
  updated_at: string
  capabilities: Capability[]
  skills: MetadataSkill[]
}

/**
 * 员工技能文件引用
 */
export interface Skill {
  source: string
  stored_path: string
  name: string
}

/**
 * 数字员工
 */
export interface Employee {
  id: number
  workspace_id: number
  employee_code: string
  name: string
  description: string | null
  version: string
  skills: Skill[]
  metadata: EmployeeMetadata
  created_at: string
  updated_at: string
}

/**
 * 群聊（员工组）
 */
export interface Group {
  id: number
  workspace_id: number
  name: string
  employee_ids: number[]
  created_at: string
  updated_at: string
}

/**
 * 聊天目标类型：单聊（员工）或群聊
 */
export type ChatTargetType = "employee" | "group"

/**
 * 创建会话参数
 */
export interface CreateConversationParams {
  workspace_id?: number
  target_type: ChatTargetType
  target_id: number
  title: string
}

/**
 * 会话列表查询参数（可选过滤条件）
 */
export interface ConversationQuery {
  workspace_id?: number
  target_type?: ChatTargetType
  target_id?: number
}

/**
 * 会话列表项
 */
export interface ConversationItem {
  id: number
  workspace_id: number
  target_type: ChatTargetType
  target_id: number
  title: string
  created_at: string
  updated_at: string
  status?: string
  lastMessage?: string
  lastMessageTime?: string
  unreadCount?: number
}

/**
 * 聊天消息
 */
export interface ChatMessage {
  id: string
  conversationId?: number
  senderId?: string
  senderName?: string
  role: "user" | "assistant" | "system"
  content: string
  chunk_json?: string
  timestamp?: string
  created_at?: string
}
