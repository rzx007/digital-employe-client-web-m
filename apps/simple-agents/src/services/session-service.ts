/**
 * Session Service - 会话管理服务
 *
 * 职责：
 * 1. 创建/获取/更新/删除会话
 * 2. 列出所有会话（支持分页和过滤）
 * 3. 管理会话对应的文件目录
 *
 * 会话是系统的基本组织单位，每个会话有：
 * - 唯一 ID
 * - 标题
 * - 时间戳
 * - 元数据（JSON）
 * - 独立的文件目录（data/workspace/{sessionId}/）
 */

import type { CreateSessionInput, UpdateSessionInput, Session } from "../types"
import { db, DATA_DIR } from "../db"
import { sessions } from "../db/schema"
import { eq, desc, sql, and } from "drizzle-orm"
import { nanoid } from "nanoid"
import path from "node:path"
import fs from "node:fs"

/**
 * 创建新会话
 *
 * 执行逻辑：
 * 1. 生成或使用指定的会话 ID
 * 2. 在数据库中创建会话记录
 * 3. 创建对应的文件目录
 *
 * @param input 会话创建参数（可选）
 * @returns 创建的会话对象
 */
export async function createSession(
  input: CreateSessionInput = {}
): Promise<Session> {
  // 生成或使用指定的会话 ID
  const id = input.id || nanoid()
  const metadata = input.metadata ? JSON.stringify(input.metadata) : null

  // 在数据库中创建会话记录
  const [session] = await db
    .insert(sessions)
    .values({ id, title: input.title || "新会话", metadata })
    .returning()

  // 创建对应的文件目录
  const sessionDir = path.join(DATA_DIR, "workspace", id)
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true })
  }

  return session
}

/**
 * 获取单个会话
 *
 * @param id 会话 ID
 * @returns 会话对象，不存在时返回 null
 */
export async function getSession(id: string): Promise<Session | null> {
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1)
  return session || null
}

/**
 * 列出所有会话
 *
 * 支持分页和过滤：
 * - page: 页码（从 1 开始）
 * - pageSize: 每页条数（默认 20）
 * - includeArchived: 是否包含已归档的会话
 *
 * @param page 页码
 * @param pageSize 每页条数
 * @param includeArchived 是否包含已归档会话
 * @returns 分页的会话列表
 */
export async function listSessions(
  page = 1,
  pageSize = 20,
  includeArchived = false
) {
  // 构建查询条件
  const where = includeArchived
    ? undefined
    : and(eq(sessions.isArchived, false))

  // 查询总数
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sessions)
    .where(where)

  // 查询数据（按更新时间降序，支持分页）
  const data = await db
    .select()
    .from(sessions)
    .where(where)
    .orderBy(desc(sessions.updatedAt))
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
 * 更新会话
 *
 * 支持更新的字段：
 * - title: 会话标题
 * - metadata: 元数据
 * - isArchived: 归档状态
 *
 * @param id 会话 ID
 * @param input 更新内容
 * @returns 更新后的会话对象，不存在时返回 null
 */
export async function updateSession(
  id: string,
  input: UpdateSessionInput
): Promise<Session | null> {
  // 构建更新值
  const values: Record<string, unknown> = { updatedAt: sql`datetime('now')` }
  if (input.title !== undefined) values.title = input.title
  if (input.metadata !== undefined)
    values.metadata = JSON.stringify(input.metadata)
  if (input.isArchived !== undefined)
    values.isArchived = input.isArchived ? 1 : 0

  // 更新数据库
  const [updated] = await db
    .update(sessions)
    .set(values)
    .where(eq(sessions.id, id))
    .returning()

  return updated || null
}

/**
 * 删除会话
 *
 * 执行逻辑：
 * 1. 删除会话对应的文件目录（递归删除，包括所有文件）
 * 2. 删除数据库中的会话记录（级联删除消息和产物记录）
 *
 * @param id 会话 ID
 * @returns 是否成功删除
 */
export async function deleteSession(id: string): Promise<boolean> {
  // 删除会话目录
  const sessionDir = path.join(DATA_DIR, "workspace", id)
  if (fs.existsSync(sessionDir)) {
    fs.rmSync(sessionDir, { recursive: true, force: true })
  }

  // 删除数据库记录（级联删除关联的 messages 和 artifacts）
  const result = await db
    .delete(sessions)
    .where(eq(sessions.id, id))
    .returning()
  return result.length > 0
}
