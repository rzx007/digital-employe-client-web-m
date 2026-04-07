/**
 * Database Schema - 数据库表结构定义
 *
 * 使用 Drizzle ORM 定义 SQLite 数据库的表结构
 * 包含 4 个核心表：sessions、messages、artifacts、stream_tasks
 *
 * 关系说明：
 * - sessions 是父表
 * - messages、artifacts、stream_tasks 都有外键关联到 sessions
 * - 使用 CASCADE 删除，删除会话时自动删除关联记录
 */

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"

/**
 * 会话表 (sessions)
 *
 * 存储所有会话的基本信息
 *
 * 字段说明：
 * - id: 唯一标识符（nanoid 生成）
 * - title: 会话标题（默认 "新会话"）
 * - created_at: 创建时间
 * - updated_at: 更新时间（每次对话后更新）
 * - metadata: 元数据（JSON 字符串）
 * - is_archived: 是否已归档（软删除标记）
 */
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("新会话"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  metadata: text("metadata"),
  isArchived: integer("is_archived", { mode: "boolean" })
    .notNull()
    .default(false),
})

/**
 * 消息表 (messages)
 *
 * 存储对话中的所有消息
 *
 * 字段说明：
 * - id: 自增主键
 * - session_id: 外键，关联到 sessions 表
 * - role: 消息角色（user/assistant/system/tool）
 * - content: 消息内容
 * - tool_calls: 工具调用信息（JSON 字符串）
 * - tool_results: 工具返回结果（JSON 字符串）
 * - token_count: token 计数
 * - created_at: 创建时间
 */
export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  role: text("role", {
    enum: ["user", "assistant", "system", "tool"],
  }).notNull(),
  content: text("content"),
  toolCalls: text("tool_calls"),
  toolResults: text("tool_results"),
  tokenCount: integer("token_count"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
})

/**
 * 文件产物表 (artifacts)
 *
 * 存储 agent 在对话过程中产生的文件元数据
 *
 * 字段说明：
 * - id: 唯一标识符（nanoid 生成）
 * - session_id: 外键，关联到 sessions 表
 * - file_path: 文件相对路径（相对于会话目录）
 * - file_name: 文件名
 * - file_size: 文件大小（字节）
 * - mime_type: MIME 类型
 * - description: 文件描述（可选）
 * - created_at: 创建时间
 */
export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  filePath: text("file_path").notNull(),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull().default(0),
  mimeType: text("mime_type").notNull().default("application/octet-stream"),
  description: text("description"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
})

/**
 * 流任务表 (stream_tasks)
 *
 * 存储流式对话的任务记录，用于页面重载恢复
 *
 * 字段说明：
 * - id: 流任务唯一标识符（nanoid 生成）
 * - session_id: 外键，关联到 sessions 表
 * - status: 任务状态（pending/streaming/completed/failed/cancelled）
 * - content: 已累积的代理回复内容（用于断线恢复）
 * - error_message: 错误信息（仅 failed 状态）
 * - message_id: 关联的消息 ID（仅 completed 状态）
 * - created_at: 创建时间
 * - updated_at: 更新时间
 *
 * 生命周期：
 * - 创建时：status = "pending"
 * - 开始流式处理：status = "streaming"，content 逐渐累积
 * - 完成：status = "completed"，关联到 messages 表
 * - 失败：status = "failed"，记录错误信息
 * - 取消：status = "cancelled"
 */
export const streamTasks = sqliteTable("stream_tasks", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  status: text("status", {
    enum: ["pending", "streaming", "completed", "failed", "cancelled"],
  })
    .notNull()
    .default("pending"),
  content: text("content").notNull().default(""),
  errorMessage: text("error_message"),
  messageId: integer("message_id"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
})
