/**
 * Agent Service - 代理服务层
 *
 * 核心职责：
 * 1. 封装 DeepAgent 的调用（同步和流式）
 * 2. 管理流式对话的生命周期（启动/取消/恢复）
 * 3. 处理消息持久化和文件产物检测
 * 4. 实现三级降级的流恢复机制（内存 → 数据库 → 消息表）
 *
 * 架构要点：
 * - agent 调用与 SSE 连接完全解耦
 * - 后台任务独立运行，客户端可随时断开/重连
 * - 通过 stream-registry 管理事件订阅和广播
 */

import type { Message, StreamEvent } from "../types"
import { agent, getSessionDir } from "../agent"
import {
  createMessage,
  getSessionMessages,
  getMessageById,
} from "./message-service"
import { updateSession } from "./session-service"
import { getSessionFiles, syncArtifacts } from "./artifact-service"
import { db } from "../db"
import { streamTasks } from "../db/schema"
import { eq, sql, desc } from "drizzle-orm"
import {
  createTask,
  getTask,
  getActiveTaskForSession,
  subscribe,
  broadcast,
  completeTask,
  failTask,
  cancelTask,
  unsubscribe,
  type ActiveTask,
} from "./stream-registry"
import { nanoid } from "nanoid"

/**
 * 将内部 Message 转换为 LangChain 消息格式
 *
 * LangChain 消息格式：{ role: "user" | "assistant", content: string }
 *
 * @param messages 内部消息列表
 * @returns LangChain 格式的消息列表
 */
function toLangchainMessages(messages: Message[]) {
  return messages.map((msg) => {
    const content = msg.content || ""
    if (msg.role === "user") {
      return { role: "user" as const, content }
    }
    if (msg.role === "assistant") {
      return { role: "assistant" as const, content }
    }
    // system 和 tool 消息转为 user 消息（LangChain 限制）
    return { role: "user" as const, content }
  })
}

/**
 * 检测会话目录中的新增文件产物
 *
 * 对比当前会话目录的文件列表与数据库中已记录的文件，
 * 同步新增和删除的文件到 artifacts 表
 *
 * @param sessionId 会话 ID
 */
function detectNewArtifacts(sessionId: string) {
  const afterSnapshot = getSessionFiles(sessionId)
  return syncArtifacts(sessionId, afterSnapshot)
}

/**
 * 同步对话（非流式）
 *
 * 流程：
 * 1. 保存用户消息到数据库
 * 2. 获取完整对话历史
 * 3. 调用 agent.invoke() 获取回复（阻塞直到完成）
 * 4. 保存代理回复到数据库
 * 5. 检测新增的文件产物
 * 6. 更新会话时间戳
 *
 * @param sessionId 会话 ID
 * @param userMessage 用户输入的消息
 * @returns 回复内容和消息记录
 */
export async function chat(
  sessionId: string,
  userMessage: string
): Promise<{ content: string; message: Message }> {
  // 1. 保存用户消息
  await createMessage(sessionId, "user", userMessage)

  // 2. 获取对话历史
  const history = await getSessionMessages(sessionId)
  const langchainMessages = toLangchainMessages(history)

  // 3. 调用 agent（阻塞等待完整回复）
  const result = await agent.invoke(
    { messages: langchainMessages as any },
    { configurable: { thread_id: sessionId } }
  )

  // 4. 提取代理回复内容
  const lastMessage = result.messages[result.messages.length - 1]
  const content =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage.content)

  // 5. 保存代理回复到数据库
  const savedMessage = await createMessage(sessionId, "assistant", content)

  // 6. 同步文件产物，更新会话时间
  await detectNewArtifacts(sessionId)
  await updateSession(sessionId, {})

  return { content, message: savedMessage }
}

/**
 * 流式对话启动结果类型
 *
 * ok=true 时返回 streamId（用于客户端标识）和 subscribe 函数
 * ok=false 时返回错误信息（可能包含正在运行的 streamId）
 */
export type StartStreamResult =
  | {
      ok: true
      streamId: string
      subscribe: (fn: (event: StreamEvent) => void) => () => void
    }
  | { ok: false; error: string; activeStreamId?: string }

/**
 * 启动流式对话
 *
 * 核心设计：
 * - 同时只会有一个活跃的流式任务（通过 stream-registry 保证）
 * - agent 调用在后台运行（fire-and-forget），不阻塞 SSE 连接
 * - 客户端通过 subscribe() 订阅事件，通过返回的取消函数取消订阅
 *
 * @param sessionId 会话 ID
 * @param userMessage 用户输入的消息
 * @returns 启动结果（包含 streamId 和 subscribe 函数）
 */
export function startStream(
  sessionId: string,
  userMessage: string
): StartStreamResult {
  // 检查是否已有活跃的流式任务
  const activeTask = getActiveTaskForSession(sessionId)
  if (activeTask) {
    return {
      ok: false,
      error: "Session already has an active stream",
      activeStreamId: activeTask.id,
    }
  }

  // 创建新的流任务
  const streamId = nanoid()
  const abortController = new AbortController()

  const task = createTask(streamId, sessionId, abortController)
  if (!task) {
    return {
      ok: false,
      error: "Failed to create stream task",
    }
  }

  // 延迟启动后台任务，给 SSE 连接的 route handler 先执行 subscribe() 的时间
  // 这样能确保订阅者在后台任务广播第一个事件时就已就绪
  setTimeout(() => {
    runAgentInBackground(sessionId, userMessage, task).catch((err) => {
      console.error(`[stream:${streamId}] unhandled error:`, err)
    })
  }, 50)

  return {
    ok: true,
    streamId,
    subscribe: (fn: (event: StreamEvent) => void) => {
      subscribe(streamId, fn)
      return () => unsubscribe(streamId, fn)
    },
  }
}

/**
 * 在后台运行 Agent 的流式对话
 *
 * 这是整个系统的核心异步流程：
 *
 * 1. 保存用户消息到数据库
 * 2. 创建 stream_tasks 记录（用于恢复）
 * 3. 广播 stream_start 事件
 * 4. 获取对话历史并调用 agent.streamEvents()
 * 5. 逐个 token 地广播事件给所有订阅者
 * 6. 定期将进度刷入数据库（每10个token或每2秒）
 * 7. 完成后保存代理回复、同步文件产物、更新任务状态
 *
 * 注意：此函数是 fire-and-forget，不会阻塞 SSE 连接
 *
 * @param sessionId 会话 ID
 * @param userMessage 用户输入的消息
 * @param task 内存中的任务引用
 */
async function runAgentInBackground(
  sessionId: string,
  userMessage: string,
  task: ActiveTask
) {
  try {
    // 1. 保存用户消息
    await createMessage(sessionId, "user", userMessage)

    // 2. 在数据库中创建流任务记录（用于页面重载恢复）
    await db.insert(streamTasks).values({
      id: task.id,
      sessionId,
      status: "streaming",
      content: "",
    })

    // 3. 广播 stream_start 事件
    broadcast(task, { type: "stream_start", streamId: task.id })

    // 4. 获取对话历史
    const history = await getSessionMessages(sessionId)
    const langchainMessages = toLangchainMessages(history)

    // 5. 调用 agent.streamEvents() 获取流式事件
    const config = { configurable: { thread_id: sessionId } }
    const eventStream = agent.streamEvents(
      { messages: langchainMessages as any },
      config
    )

    // 6. 流式事件处理变量
    let fullContent = ""
    let tokenCount = 0
    const FLUSH_INTERVAL = 2000 // 定期刷入数据库的间隔（毫秒）
    let lastFlush = Date.now()

    /**
     * 将当前进度刷入数据库
     *
     * 用途：在页面重载时，能恢复已接收的部分内容
     */
    async function flushToDb() {
      await db
        .update(streamTasks)
        .set({
          content: fullContent,
          status: "streaming",
          updatedAt: sql`datetime('now')`,
        })
        .where(eq(streamTasks.id, task.id))
      lastFlush = Date.now()
    }

    // 7. 处理流式事件
    for await (const event of eventStream) {
      // 检查是否被取消
      if (task.abortController.signal.aborted) break

      // 处理模型流事件（逐 token）
      if (
        event.event === "on_chat_model_stream" &&
        event.data?.chunk?.content &&
        typeof event.data.chunk.content === "string"
      ) {
        fullContent += event.data.chunk.content
        tokenCount++

        // 更新任务内容并广播 token 事件
        task.content = fullContent
        broadcast(task, { type: "token", content: event.data.chunk.content })

        // 定期刷入数据库
        if (tokenCount % 10 === 0 || Date.now() - lastFlush > FLUSH_INTERVAL) {
          await flushToDb()
        }
      }

      // 处理工具调用开始事件
      if (event.event === "on_tool_start") {
        broadcast(task, {
          type: "tool_start",
          name: event.name,
          input: event.data?.input,
        })
      }

      // 处理工具调用结束事件（截取前200字符）
      if (event.event === "on_tool_end") {
        broadcast(task, {
          type: "tool_end",
          name: event.name,
          output:
            typeof event.data?.output === "string"
              ? event.data.output.substring(0, 200)
              : JSON.stringify(event.data?.output).substring(0, 200),
        })
      }
    }

    // 8. 检查是否被用户取消
    if (task.abortController.signal.aborted) {
      await db
        .update(streamTasks)
        .set({ status: "cancelled", updatedAt: sql`datetime('now')` })
        .where(eq(streamTasks.id, task.id))
      completeTask(task.id, null)
      return
    }

    // 9. 保存代理回复到数据库
    const savedMessage = await createMessage(
      sessionId,
      "assistant",
      fullContent
    )

    // 10. 同步文件产物，更新任务状态
    await flushToDb()
    await db
      .update(streamTasks)
      .set({
        status: "completed",
        messageId: savedMessage.id,
        updatedAt: sql`datetime('now')`,
      })
      .where(eq(streamTasks.id, task.id))

    await detectNewArtifacts(sessionId)
    await updateSession(sessionId, {})

    // 11. 广播 done 事件，标记任务完成
    broadcast(task, {
      type: "done",
      messageId: savedMessage.id,
      streamId: task.id,
    })

    completeTask(task.id, savedMessage.id)
  } catch (error: any) {
    // 12. 错误处理：更新任务状态，广播错误
    const errMsg = error?.message || "Unknown error"

    await db
      .update(streamTasks)
      .set({
        status: "failed",
        errorMessage: errMsg,
        updatedAt: sql`datetime('now')`,
      })
      .where(eq(streamTasks.id, task.id))

    failTask(task.id, errMsg)
  }
}

/**
 * 流恢复结果类型
 *
 * ok=true 时返回内存中的任务引用和 subscribe 函数
 * ok=false 时返回错误信息
 */
export type ResumeResult =
  | {
      ok: true
      task: ActiveTask
      subscribe: (fn: (event: StreamEvent) => void) => () => void
    }
  | { ok: false; error: string }

/**
 * 恢复/订阅指定的流
 *
 * 用途：客户端断线后重新连接，订阅正在运行的流
 *
 * @param streamId 流的唯一标识符
 * @returns 恢复结果
 */
export function resumeStream(streamId: string): ResumeResult {
  const task = getTask(streamId)
  if (!task) {
    return { ok: false, error: "Stream not found or expired" }
  }

  return {
    ok: true,
    task,
    subscribe: (fn: (event: StreamEvent) => void) => {
      subscribe(streamId, fn)
      return () => unsubscribe(streamId, fn)
    },
  }
}

/**
 * 取消指定的流
 *
 * 用途：用户主动取消正在进行的对话
 *
 * @param streamId 流的唯一标识符
 * @returns 是否成功取消
 */
export function cancelStream(streamId: string): boolean {
  return cancelTask(streamId)
}

/**
 * 流状态类型
 */
export type StreamStatus = {
  active: boolean
  streamId?: string
  status?: string
  lastStreamId?: string
  lastStatus?: string
  lastMessageId?: number | null
}

/**
 * 获取会话的流状态
 *
 * 用途：前端页面加载时，检查会话是否有活跃的流
 *
 * @param sessionId 会话 ID
 * @returns 流状态
 */
export function getStreamStatus(sessionId: string): StreamStatus {
  const task = getActiveTaskForSession(sessionId)
  if (task) {
    return { active: true, streamId: task.id, status: task.status }
  }
  return { active: false }
}

/**
 * 解析后的流类型
 *
 * 用于 resolveStream() 的返回值
 */
export type ResolvedStream =
  | {
      ok: true
      source: "memory" | "db" // 数据来源：内存或数据库
      status: "streaming" | "completed" | "failed" | "cancelled"
      content: string
      errorMessage?: string | null
      messageId?: number | null
      streamId: string
    }
  | { ok: false; error: string }

/**
 * 解析会话的流状态（支持页面重载恢复）
 *
 * 这是页面重载恢复的核心函数，实现三级降级查找：
 *
 * 第一级：内存注册表（stream-registry）
 *   - 找到 → 返回活跃的任务（可能是 streaming 或刚 completed）
 *   - 未找到 → 继续到第二级
 *
 * 第二级：数据库 stream_tasks 表
 *   - 根据 session_id 查找最近一条流任务记录
 *   - completed → 从 messages 表读取完整内容
 *   - streaming → 标记为 failed（僵尸任务，服务器可能重启了）
 *   - failed → 返回错误信息
 *   - cancelled → 返回取消内容
 *
 * @param sessionId 会话 ID
 * @returns 解析后的流信息
 */
export async function resolveStream(
  sessionId: string
): Promise<ResolvedStream> {
  // 第一级：检查内存注册表
  const memTask = getActiveTaskForSession(sessionId)
  if (memTask) {
    return {
      ok: true,
      source: "memory",
      status: memTask.status,
      content: memTask.content,
      errorMessage: memTask.errorMessage,
      messageId: memTask.messageId,
      streamId: memTask.id,
    }
  }

  // 第二级：检查数据库
  const latest = await getLatestStreamTask(sessionId)
  if (!latest) {
    return { ok: false, error: "No stream found for this session" }
  }

  // 处理 completed 状态：读取完整消息
  if (latest.status === "completed" && latest.messageId) {
    const msg = await getMessageById(latest.messageId)
    return {
      ok: true,
      source: "db",
      status: "completed",
      content: msg?.content || latest.content,
      messageId: latest.messageId,
      streamId: latest.id,
    }
  }

  // 处理 completed 但无 messageId 的情况
  if (latest.status === "completed") {
    return {
      ok: true,
      source: "db",
      status: "completed",
      content: latest.content,
      messageId: latest.messageId,
      streamId: latest.id,
    }
  }

  // 处理僵尸任务（服务器重启或进程崩溃）
  // 将 status 从 streaming 更新为 failed，并附带错误信息
  if (latest.status === "streaming") {
    await db
      .update(streamTasks)
      .set({
        status: "failed",
        errorMessage: "Server restarted or process crashed during streaming",
        content: latest.content,
        updatedAt: sql`datetime('now')`,
      })
      .where(eq(streamTasks.id, latest.id))

    return {
      ok: true,
      source: "db",
      status: "failed",
      content: latest.content,
      errorMessage: "Server restarted or process crashed during streaming",
      streamId: latest.id,
    }
  }

  // 处理 failed 状态
  if (latest.status === "failed") {
    return {
      ok: true,
      source: "db",
      status: "failed",
      content: latest.content,
      errorMessage: latest.errorMessage,
      streamId: latest.id,
    }
  }

  // 处理 cancelled 状态
  if (latest.status === "cancelled") {
    return {
      ok: true,
      source: "db",
      status: "cancelled",
      content: latest.content,
      streamId: latest.id,
    }
  }

  return { ok: false, error: "Unknown stream status" }
}

/**
 * 获取会话的最新流任务记录
 *
 * 用途：在内存注册表中找不到任务时，从数据库中查找
 *
 * @param sessionId 会话 ID
 * @returns 最新的流任务记录，如果没有则返回 null
 */
export async function getLatestStreamTask(sessionId: string) {
  const [row] = await db
    .select()
    .from(streamTasks)
    .where(eq(streamTasks.sessionId, sessionId))
    .orderBy(desc(streamTasks.createdAt))
    .limit(1)

  return row || null
}

export { getSessionDir }
