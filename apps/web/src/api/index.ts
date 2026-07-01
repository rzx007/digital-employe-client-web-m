/**
 * API 模块统一导出
 */

// 类型定义
export * from "./types"

// 员工管理
export {
  fetchEmployees,
  fetchEmployeeById,
  deleteEmployee,
} from "./employee"

// 聊天会话
export {
  createConversation,
  fetchConversations,
  fetchConversationMessages,
  streamConversation,
} from "./conversation"

// 认证
export { loginApi, registerApi } from "./auth"

// 部门（注册等）
export { getDeptTree, type DeptTreeNode } from "./dept"
