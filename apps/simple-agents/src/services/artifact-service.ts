/**
 * Artifact Service - 文件产物管理服务
 *
 * 职责：
 * 1. 同步会话目录的文件到数据库（检测新增/删除）
 * 2. 列出/获取/删除文件产物
 * 3. 管理文件的元数据（大小、类型、创建时间）
 *
 * 产物是 agent 在对话过程中产生的文件：
 * - 由 agent 的文件工具创建（write_file、edit_file 等）
 * - 存储在会话目录下（data/workspace/{sessionId}/）
 * - 元数据存储在 artifacts 表中
 *
 * 同步机制：
 * - 对话完成后自动检测新增/删除的文件
 * - 对比会话目录的文件列表和数据库记录
 */

import type { Artifact } from "../types"
import { db, DATA_DIR } from "../db"
import { artifacts } from "../db/schema"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import path from "node:path"
import fs from "node:fs"

/**
 * MIME 类型映射表
 *
 * 用于根据文件扩展名推断文件类型
 */
const MIME_TYPES: Record<string, string> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".csv": "text/csv",
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".ts": "text/typescript",
  ".py": "text/x-python",
  ".xml": "application/xml",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
}

/**
 * 根据文件名获取 MIME 类型
 *
 * @param fileName 文件名
 * @returns MIME 类型字符串
 */
function getMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase()
  return MIME_TYPES[ext] || "application/octet-stream"
}

/**
 * 同步会话目录的文件产物到数据库
 *
 * 执行逻辑：
 * 1. 获取数据库中已记录的文件
 * 2. 对比会话目录中的实际文件
 * 3. 新增的文件：插入数据库
 * 4. 删除的文件：从数据库移除
 *
 * @param sessionId 会话 ID
 * @param existingFiles 会话目录中的文件集合
 * @returns 新增和删除的产物列表
 */
export async function syncArtifacts(
  sessionId: string,
  existingFiles: Set<string>
): Promise<{ added: Artifact[]; removed: Artifact[] }> {
  const sessionDir = path.join(DATA_DIR, "workspace", sessionId)

  // 获取数据库中已记录的文件
  const existing = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.sessionId, sessionId))

  const existingMap = new Map<string, Artifact>()
  for (const row of existing) {
    existingMap.set(row.filePath, row)
  }

  const added: Artifact[] = []
  const removed: Artifact[] = []

  // 检测新增的文件
  for (const filePath of existingFiles) {
    if (!existingMap.has(filePath)) {
      // 获取文件信息
      const fullPath = path.join(sessionDir, filePath)
      const stat = fs.statSync(fullPath)
      const fileName = path.basename(filePath)

      // 插入数据库
      const [artifact] = await db
        .insert(artifacts)
        .values({
          id: nanoid(),
          sessionId,
          filePath,
          fileName,
          fileSize: stat.size,
          mimeType: getMimeType(fileName),
        })
        .returning()

      added.push(artifact)
    }
  }

  // 检测删除的文件
  for (const [filePath, artifact] of existingMap) {
    if (!existingFiles.has(filePath)) {
      await db.delete(artifacts).where(eq(artifacts.id, artifact.id))
      removed.push(artifact)
    }
  }

  return { added, removed }
}

/**
 * 获取会话目录的所有文件
 *
 * 递归遍历会话目录，返回所有文件的相对路径
 *
 * @param sessionId 会话 ID
 * @returns 文件路径集合
 */
export function getSessionFiles(sessionId: string): Set<string> {
  const sessionDir = path.join(DATA_DIR, "workspace", sessionId)
  const files = new Set<string>()

  if (!fs.existsSync(sessionDir)) return files

  // 递归遍历目录
  function walk(dir: string, base: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const relativePath = base ? `${base}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relativePath)
      } else {
        files.add(relativePath)
      }
    }
  }

  walk(sessionDir, "")
  return files
}

/**
 * 列出会话的所有文件产物
 *
 * @param sessionId 会话 ID
 * @returns 产物列表
 */
export async function listArtifacts(sessionId: string): Promise<Artifact[]> {
  return db
    .select()
    .from(artifacts)
    .where(eq(artifacts.sessionId, sessionId))
    .orderBy(artifacts.createdAt)
}

/**
 * 获取单个文件产物
 *
 * @param id 产物 ID
 * @returns 产物对象，不存在时返回 null
 */
export async function getArtifact(id: string): Promise<Artifact | null> {
  const [artifact] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, id))
    .limit(1)

  return artifact || null
}

/**
 * 删除单个文件产物
 *
 * 执行逻辑：
 * 1. 从数据库获取产物信息
 * 2. 删除磁盘上的文件
 * 3. 从数据库中删除记录
 *
 * @param id 产物 ID
 * @returns 是否成功删除
 */
export async function deleteArtifact(id: string): Promise<boolean> {
  const artifact = await getArtifact(id)
  if (!artifact) return false

  // 删除磁盘文件
  const filePath = path.join(
    DATA_DIR,
    "workspace",
    artifact.sessionId,
    artifact.filePath
  )
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }

  // 删除数据库记录
  const result = await db
    .delete(artifacts)
    .where(eq(artifacts.id, id))
    .returning()
  return result.length > 0
}

/**
 * 删除会话的所有文件产物
 *
 * 注意：只删除数据库记录，不删除磁盘文件
 * 磁盘文件在会话删除时一并删除
 *
 * @param sessionId 会话 ID
 */
export async function deleteSessionArtifacts(sessionId: string): Promise<void> {
  await db.delete(artifacts).where(eq(artifacts.sessionId, sessionId))
}
