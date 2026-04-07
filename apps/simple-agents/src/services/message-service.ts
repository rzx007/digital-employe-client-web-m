/**
 * Message Service - 消息管理服务
 *
 * 职责：
 * 1. 创建/获取/删除消息
 * 2. 分页查询会话消息
 * 3. 获取会话完整历史（用于构建 agent 上下文）
 *
 * 消息是对话的基本单位，包含：
 * - ID（自增主键）
 * - 会话 ID（外键）
 * - 角色（user/assistant/system/tool）
 * - 内容
 * - 工具调用/结果（可选）
 * - Token 计数（可选）
 * - 创建时间
 */

import type { Message } from "../types"
import { db } from "../db"
import { messages } from "../db/schema"
import { eq, asc, sql, and, gt } from "drizzle-orm"

/**
 * 创建新消息
 *
 * @param sessionId 会话 ID
 * @param role 消息角色（user/assistant/system/tool）
 * @param content 消息内容
 * @param options 可选参数（工具调用、token 计数等）
 * @returns 创建的消息对象
 */
export async function createMessage(
  sessionId: string,
  role: Message["role"],
  content: string | null,
  options?: {
    toolCalls?: unknown
    toolResults?: unknown
    tokenCount?: number
  }
): Promise<Message> {
  const [msg] = await db
    .insert(messages)
    .values({
      sessionId,
      role,
      content,
      toolCalls: options?.toolCalls ? JSON.stringify(options.toolCalls) : null,
      toolResults: options?.toolResults
        ? JSON.stringify(options.toolResults)
        : null,
      tokenCount: options?.tokenCount,
    })
    .returning()

  return msg
}

/**
 * 分页获取会话消息
 *
 * @param sessionId 会话 ID
 * @param page 页码（从 1 开始）
 * @param pageSize 每页条数（默认 50）
 * @param before 游标（可选，获取 ID 大于此值的消息）
 * @returns 分页的消息列表
 */
export async function getMessages(
  sessionId: string,
  page = 1,
  pageSize = 50,
  before?: number
) {
  // 构建查询条件
  const conditions = [eq(messages.sessionId, sessionId)]
  if (before !== undefined) {
    conditions.push(gt(messages.id, before))
  }

  const where = and(...conditions)

  // 查询总数
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .where(where)

  // 查询数据（按 ID 升序，支持分页）
  const data = await db
    .select()
    .from(messages)
    .where(where)
    .orderBy(asc(messages.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  return {
    data,
    total: Number(count),
    page,
    pageSize,
    totalPages: Math.ceil(Number(count) / pageSize),
  }
}

/**
 * 获取会话的完整消息历史
 *
 * 用途：构建 agent 的对话上下文
 *
 * @param sessionId 会话 ID
 * @returns 按时间顺序排列的消息列表
 */
export async function getSessionMessages(
  sessionId: string
): Promise<Message[]> {
  return db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.id))
}

/**
 * 获取会话的最新消息
 *
 * @param sessionId 会话 ID
 * @param limit 最大条数（默认 20）
 * @returns 最新的消息列表
 */
export async function getLatestMessages(
  sessionId: string,
  limit = 20
): Promise<Message[]> {
  const all = await db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.id))

  // 返回最后 limit 条消息
  return all.slice(-limit)
}

/**
 * 获取会话消息总数
 *
 * @param sessionId 会话 ID
 * @returns 消息总数
 */
export async function getMessageCount(sessionId: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))

  return Number(count)
}

/**
 * 根据 ID 获取单个消息
 *
 * 用途：在流恢复时，获取已完成的消息内容
 *
 * @param id 消息 ID
 * @returns 消息对象，不存在时返回 null
 */
export async function getMessageById(id: number): Promise<Message | null> {
  const [msg] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, id))
    .limit(1)

  return msg || null
}

/**
 * 删除会话的所有消息
 *
 * 注意：通常级联删除会自动处理，此方法用于手动清理
 *
 * @param sessionId 会话 ID
 */
export async function deleteSessionMessages(sessionId: string): Promise<void> {
  await db.delete(messages).where(eq(messages.sessionId, sessionId))
}
