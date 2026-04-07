/**
 * Chat Routes - 对话路由
 *
 * 提供对话相关的 HTTP 端点：
 *
 * 1. GET  /:id/messages          - 获取会话的消息历史
 * 2. POST /:id/chat              - 同步对话（非流式）
 * 3. POST /:id/chat/stream       - 流式对话（SSE）
 * 4. GET  /:id/stream/:streamId  - 恢复/订阅指定流
 * 5. POST /:id/stream/:streamId/cancel - 取消指定流
 * 6. GET  /:id/stream            - 查询会话的流状态
 *
 * 设计要点：
 * - 流式对话使用 SSE (Server-Sent Events) 实现
 * - 通过队列 + 轮询机制实现事件推送
 * - 支持断线重连（通过 streamId 标识）
 * - 后台任务与 SSE 连接解耦
 */

import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { getMessages } from "../services/message-service"
import {
  chat,
  startStream,
  resumeStream,
  cancelStream,
  getStreamStatus,
  resolveStream,
} from "../services/agent-service"
import { getSession } from "../services/session-service"
import type { SendMessageInput, StreamEvent } from "../types"

const app = new Hono()

// ============ 消息历史接口 ============

/**
 * GET /:id/messages - 获取会话的消息历史
 *
 * @param id 会话 ID
 * @param page 页码（默认 1）
 * @param pageSize 每页条数（默认 50）
 * @returns 分页的消息列表
 */
app.get("/:id/messages", async (c) => {
  const id = c.req.param("id")
  const page = Number(c.req.query("page")) || 1
  const pageSize = Number(c.req.query("pageSize")) || 50

  const result = await getMessages(id, page, pageSize)
  return c.json(result)
})

// ============ 同步对话接口 ============

/**
 * POST /:id/chat - 同步对话（非流式）
 *
 * 完整流程：
 * 1. 验证请求参数
 * 2. 检查会话是否存在
 * 3. 检查是否有活跃的流（有则返回 409）
 * 4. 调用 agent.chat() 获取回复
 * 5. 返回回复内容和消息 ID
 *
 * @param id 会话 ID
 * @param message 用户输入的消息
 * @returns 回复内容和消息 ID
 */
app.post("/:id/chat", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<SendMessageInput>()

  // 参数验证
  if (!body.message || typeof body.message !== "string") {
    return c.json({ error: "message is required (string)" }, 400)
  }

  // 检查会话是否存在
  const session = await getSession(id)
  if (!session) return c.json({ error: "Session not found" }, 404)

  // 检查是否有活跃的流（防止并发）
  const status = getStreamStatus(id)
  if (status.active) {
    return c.json(
      {
        error: "Session has an active stream",
        activeStreamId: status.streamId,
      },
      409
    )
  }

  try {
    const result = await chat(id, body.message)
    return c.json({
      content: result.content,
      messageId: result.message.id,
    })
  } catch (error: any) {
    return c.json({ error: error.message || "Agent invocation failed" }, 500)
  }
})

// ============ 流式对话接口 ============

/**
 * POST /:id/chat/stream - 流式对话（SSE）
 *
 * 完整流程：
 * 1. 验证请求参数
 * 2. 检查会话是否存在
 * 3. 调用 startStream() 启动后台任务
 * 4. 建立 SSE 连接，订阅事件并推送给客户端
 * 5. 客户端断开时清理订阅
 *
 * @param id 会话 ID
 * @param message 用户输入的消息
 * @returns SSE 事件流
 */
app.post("/:id/chat/stream", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<SendMessageInput>()

  // 参数验证
  if (!body.message || typeof body.message !== "string") {
    return c.json({ error: "message is required (string)" }, 400)
  }

  // 检查会话是否存在
  const session = await getSession(id)
  if (!session) return c.json({ error: "Session not found" }, 404)

  // 启动流式对话
  const result = startStream(id, body.message)

  // 如果启动失败（已有活跃流），返回 409
  if (!result.ok) {
    return c.json(
      { error: result.error, activeStreamId: result.activeStreamId },
      409
    )
  }

  // 建立 SSE 连接
  return streamSSE(c, async (stream) => {
    const streamId = result.streamId
    const queue: StreamEvent[] = []

    // 立即发送 stream_start 事件
    await stream.writeSSE({
      data: JSON.stringify({ type: "stream_start", streamId }),
    })

    // 订阅事件，推入队列（不直接写 SSE，避免异步问题）
    const unsub = result.subscribe((event: StreamEvent) => {
      queue.push(event)
    })

    // 客户端断开时触发
    let aborted = false
    stream.onAbort(() => {
      aborted = true
      unsub() // 取消订阅
    })

    // 保持 SSE 连接活跃（Hono 要求回调保持运行）
    while (!aborted) {
      // 队列中有事件就发送
      while (queue.length > 0) {
        const event = queue.shift()!
        await stream.writeSSE({ data: JSON.stringify(event) })
        // 终止事件：关闭 SSE 连接
        if (
          event.type === "done" ||
          event.type === "error" ||
          event.type === "cancelled"
        ) {
          unsub()
          return
        }
      }
      // 队列空时休眠 100ms，避免空转
      await stream.sleep(100)
    }
  })
})

// ============ 流恢复接口 ============

/**
 * GET /:id/stream/:streamId - 恢复/订阅指定流
 *
 * 用途：客户端断线后重新连接，获取流的当前状态
 *
 * 恢复策略：
 * - 内存任务存在 → 返回任务状态（如果 completed 则直接返回 JSON，否则 SSE 续流）
 * - 内存任务不存在 → 降级查数据库（三级降级：内存 → DB → 消息表）
 *
 * @param id 会话 ID
 * @param streamId 流标识符
 * @returns 流状态（JSON）或 SSE 续流
 */
app.get("/:id/stream/:streamId", async (c) => {
  const streamId = c.req.param("streamId")

  // 尝试从内存注册表恢复
  const result = resumeStream(streamId)

  if (result.ok) {
    const { task } = result

    // 如果任务已完成，直接返回 JSON
    if (task.completed) {
      if (task.status === "completed") {
        return c.json({
          status: "completed",
          content: task.content,
          messageId: task.messageId,
          streamId: task.id,
        })
      }
      if (task.status === "failed") {
        return c.json({
          status: "failed",
          error: task.errorMessage,
          streamId: task.id,
        })
      }
      if (task.status === "cancelled") {
        return c.json({
          status: "cancelled",
          content: task.content,
          streamId: task.id,
        })
      }
    }

    // 任务仍在运行，返回 SSE 续流
    return streamSSE(c, async (stream) => {
      const cachedContent = task.content

      // 先发送已缓存的内容（恢复场景）
      if (cachedContent) {
        await stream.writeSSE({
          data: JSON.stringify({
            type: "recovery",
            content: cachedContent,
            streamId,
          }),
        })
      }

      // 订阅后续事件
      const queue: StreamEvent[] = []

      const unsub = result.subscribe((event: StreamEvent) => {
        queue.push(event)
      })

      let aborted = false
      stream.onAbort(() => {
        aborted = true
        unsub()
      })

      // 轮询队列，发送后续事件
      while (!aborted) {
        while (queue.length > 0) {
          const event = queue.shift()!
          await stream.writeSSE({ data: JSON.stringify(event) })
          // 终止事件：关闭 SSE 连接
          if (
            event.type === "done" ||
            event.type === "error" ||
            event.type === "cancelled"
          ) {
            unsub()
            return
          }
        }
        await stream.sleep(100)
      }
    })
  }

  // 内存中没有，降级查数据库
  const sessionId = c.req.param("id")
  const resolved = await resolveStream(sessionId)

  if (!resolved.ok) {
    return c.json({ error: "Stream not found or expired" }, 404)
  }

  // 检查 streamId 是否匹配
  if (resolved.streamId !== streamId) {
    return c.json(
      {
        error: "Stream not found or expired",
        latestStreamId: resolved.streamId,
        latestStatus: resolved.status,
      },
      404
    )
  }

  // 返回数据库中的流状态
  return c.json({
    status: resolved.status,
    content: resolved.content,
    error: resolved.errorMessage,
    messageId: resolved.messageId,
    streamId: resolved.streamId,
    source: resolved.source,
  })
})

// ============ 流取消接口 ============

/**
 * POST /:id/stream/:streamId/cancel - 取消指定流
 *
 * 用途：用户主动取消正在进行的对话
 *
 * @param streamId 流标识符
 * @returns 取消结果
 */
app.post("/:id/stream/:streamId/cancel", async (c) => {
  const streamId = c.req.param("streamId")
  const cancelled = cancelStream(streamId)

  if (!cancelled) {
    return c.json(
      { error: "Stream not found, already completed, or expired" },
      404
    )
  }

  return c.json({ success: true, streamId })
})

// ============ 流状态查询接口 ============

/**
 * GET /:id/stream - 查询会话的流状态
 *
 * 用途：前端页面加载时，检查会话是否有活跃的流
 *
 * 返回值：
 * - 如果有活跃流 → { active: true, streamId, status }
 * - 如果没有活跃流但有历史流 → { active: false, lastStreamId, lastStatus, lastMessageId }
 * - 如果从未有过流 → { active: false }
 *
 * @param id 会话 ID
 * @returns 流状态信息
 */
app.get("/:id/stream", async (c) => {
  const id = c.req.param("id")

  // 检查内存中是否有活跃流
  const status = getStreamStatus(id)
  if (status.active) {
    return c.json(status)
  }

  // 降级查数据库（最近的流任务）
  const resolved = await resolveStream(id)
  if (!resolved.ok) {
    return c.json({ active: false })
  }

  return c.json({
    active: false,
    lastStreamId: resolved.streamId,
    lastStatus: resolved.status,
    lastMessageId: resolved.messageId,
  })
})

export default app
