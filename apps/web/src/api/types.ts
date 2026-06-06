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
 * MCP 能力列表项
 */
export interface McpListItem {
  id: number
  capability_name: string
  capability_desc: string
  mcp_server_name: string
  mcp_tool_name: string
  creator_id: number
  created_at: string
  updated_at: string
}

/**
 * 技能列表项
 */
export interface SkillListItem {
  id: number
  skillName: string
  description: string | null
  displayNameZh: string | null
  tags?: string[]
  prompt?: string
  inputSchema?: unknown
  skillContent?: string
  directoryId: number | null
  status?: number
  createTime?: string
  updateTime?: string
  directoryName: string | null
  source?: "remote" | "local" | "builtin"
  sourceLabel?: string
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
  [x: string]: any
}
export interface MetadataMcp {
  id: number
  mcp_server_name: string
  mcp_tool_name: string
  createTime?: string
  updateTime?: string
  [x: string]: any
}

export interface MetadataTask {
  task_name: string
  dispatch_type: "mcp" | "skill" | string
  skill_id: number | null
  capability_id: number | null
  priority?: number
  task_type?: number
  cron_expression?: string
  cron_expression_type?: string
  is_active?: boolean
  confirm_execution_result?: boolean
  config?: {
    input?: {
      prompt?: string
      user_prompt?: string
      [x: string]: unknown
    }
    [x: string]: unknown
  }
  user_prompt?: string
  [x: string]: unknown
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
  mcps: MetadataMcp[]
  tasks?: MetadataTask[]
}

/**
 * 员工技能文件引用
 */
export interface Skill {
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
 * 数字员工
 */
export interface ShiftSchedule {
  start_date?: string
  end_date?: string
  status?: number
  notes?: string
}

export interface Employee {
  id: number
  workspace_id: number
  employee_code: string
  name: string
  description: string | null
  version: string
  skills: Skill[]
  metadata: EmployeeMetadata
  shift_schedule: ShiftSchedule
  is_curator: boolean
  /** 自定义上传头像 URL；为空时前端回落到「名字前两个字」文本头像。 */
  avatar?: string | null
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
export type ChatTargetType = "employee" | "group" | "curator"

/**
 * 创建会话参数
 */
export interface CreateConversationParams {
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
 * 会话列表项（API 响应，snake_case 时间字段）
 */
export interface ConversationListItemDto {
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
 * 聊天消息（API 响应）
 */
export interface ChatMessageDto {
  id: string
  conversationId?: number
  conversation_id?: number
  senderId?: string
  senderName?: string
  /** 群时间线作者归属（后端 snake_case 字段） */
  sender_id?: number | null
  sender_label?: string | null
  role: "user" | "assistant" | "system"
  content: string
  chunk_json?: string
  stream_state?: string | null
  stream_cursor?: number | null
  extra_meta?: Record<string, any>
  message_parts?: unknown[] | null
  timestamp?: string
  created_at?: string
}

/**
 * 部门信息
 */
export interface Department {
  id: number
  name: string
  parentId: number | null
  description: string | null
  createTime: string | null
  updateTime: string | null
  status: string
}

/**
 * 登录用户信息（后端 result 数组中的对象）
 */
export interface LoginUser {
  id: number
  name: string
  username: string
  menuid: string
  orgType: string | null
  orgNo: string | null
  email: string
  phoneNumber: string
  expirationTime: string | null
  status: string
  loginTime: string
  changePwdTime: string
  inTime: string | null
  inIp: string | null
  consInfo: Record<string, unknown>
  dpts: Department[]
}

/**
 * 用户注册接口响应
 */
export interface RegisterResponse {
  code: number
  msg: string
}

/**
 * 登录响应（后端实际返回结构）
 *
 * code === 1  : 登录成功，result 为用户数组
 * code === -2 : 密码已过期，result 为单个用户对象（含 id）
 * code === 0  : 登录失败
 */
export type LoginResponse =
  | {
      code: 1
      result: LoginUser[]
      noMenus: boolean
      token: string
      msg: string
    }
  | {
      code: -2
      result: { id: number; userName?: string }
      token: string
      msg: string
    }
  | {
      code: 0
      result?: undefined
      token?: string
      msg: string
    }

export interface LocalSkillItem {
  skillName: string
  path: string
  localId?: number | null
  hasSkillMd: boolean
  importedAt: string | null
  description?: string | null
  displayNameZh?: string | null
  isBuiltin?: boolean
  directoryId?: number | null
}

export interface LocalSkillDetail {
  skillName: string
  path: string
  localId?: number | null
  directoryId?: number | null
  importedAt: string | null
  skillMdContent: string | null
  files: string[]
  displayNameZh?: string | null
  isBuiltin?: boolean
}

export interface LocalSkillImportResult {
  skillName: string
  localId?: number | null
  path: string
  overwritten: boolean
}

export interface ResourceEntry {
  name: string
  path: string
  entry_type: "file" | "directory"
  artifact_type: string | null
  size: number
  modified_at: number | null
  children: ResourceEntry[] | null
}

export interface ResourceList {
  artifacts: ResourceEntry[]
  uploads: ResourceEntry[]
  skills_draft: ResourceEntry[]
}

export interface ResourceContent {
  path: string
  content: string
  artifact_type: string
  language: string | null
}

export interface ResourceUploadResult {
  name: string
  path: string
  size: number
}
