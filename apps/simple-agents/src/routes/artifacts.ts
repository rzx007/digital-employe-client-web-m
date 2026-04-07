/**
 * Artifacts Routes - 文件产物管理路由
 *
 * 提供文件产物相关的 HTTP 端点：
 *
 * 1. GET    /:id/artifacts              - 列出会话的所有文件产物
 * 2. GET    /:id/artifacts/:artifactId  - 下载/查看单个文件产物
 * 3. DELETE /:id/artifacts/:artifactId  - 删除单个文件产物
 */

import { Hono } from "hono"
import {
  listArtifacts,
  getArtifact,
  deleteArtifact,
} from "../services/artifact-service"
import { DATA_DIR } from "../db"
import path from "node:path"
import fs from "node:fs"

const app = new Hono()

/**
 * GET /:id/artifacts - 列出会话的所有文件产物
 *
 * @param id 会话 ID
 * @returns 产物列表
 */
app.get("/:id/artifacts", async (c) => {
  const sessionId = c.req.param("id")
  const artifacts = await listArtifacts(sessionId)
  return c.json(artifacts)
})

/**
 * GET /:id/artifacts/:artifactId - 下载/查看单个文件产物
 *
 * 功能：
 * - 从数据库获取产物信息
 * - 读取磁盘上的文件内容
 * - 设置正确的 Content-Type 响应头
 *
 * @param artifactId 产物 ID
 * @returns 文件内容（原始二进制或文本）
 */
app.get("/:id/artifacts/:artifactId", async (c) => {
  const artifactId = c.req.param("artifactId")
  const artifact = await getArtifact(artifactId)
  if (!artifact) return c.json({ error: "Artifact not found" }, 404)

  // 构建文件完整路径
  const filePath = path.join(
    DATA_DIR,
    "workspace",
    artifact.sessionId,
    artifact.filePath
  )

  // 检查文件是否存在
  if (!fs.existsSync(filePath))
    return c.json({ error: "File not found on disk" }, 404)

  // 读取文件内容并返回
  const stat = fs.statSync(filePath)
  const content = fs.readFileSync(filePath)

  return new Response(content, {
    headers: {
      "Content-Type": artifact.mimeType,
      "Content-Length": String(stat.size),
      // 设置为 inline，浏览器尝试直接显示；否则会下载
      "Content-Disposition": `inline; filename="${encodeURIComponent(artifact.fileName)}"`,
    },
  })
})

/**
 * DELETE /:id/artifacts/:artifactId - 删除单个文件产物
 *
 * 功能：
 * - 删除磁盘上的文件
 * - 从数据库中删除记录
 *
 * @param artifactId 产物 ID
 * @returns 删除结果
 */
app.delete("/:id/artifacts/:artifactId", async (c) => {
  const artifactId = c.req.param("artifactId")
  const deleted = await deleteArtifact(artifactId)
  if (!deleted) return c.json({ error: "Artifact not found" }, 404)
  return c.json({ success: true })
})

export default app
