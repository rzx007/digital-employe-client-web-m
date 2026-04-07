/**
 * API 模块统一导出
 */

// 类型定义
export * from "./types"

// 员工管理
export {
  syncEmployees,
  fetchEmployees,
  fetchEmployeeById,
  deleteEmployee,
} from "./employee"

// 群聊管理
export {
  createGroup,
  fetchGroups,
  fetchGroupById,
  deleteGroup,
  type CreateGroupParams,
} from "./group"

// 聊天会话
export {
  createConversation,
  fetchConversations,
  fetchConversationMessages,
  streamConversation,
} from "./conversation"
