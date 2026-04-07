/**
 * Stream Registry - 流任务注册表
 *
 * 核心职责：
 * 1. 管理流式任务的生命周期（创建、完成、失败、取消）
 * 2. 管理事件订阅者（subscribe/unsubscribe）
 * 3. 向订阅者广播事件（broadcast）
 * 4. 防止同一会话的并发流任务（session 级互斥）
 * 5. 自动清理过期任务（TTL 机制）
 *
 * 架构：
 * - 内存存储：任务注册表 + 会话索引
 * - 与 SSE 连接解耦：订阅者可以随时加入/退出
 * - 与数据库解耦：数据库存储持久化，内存管理运行时
 */

import type { StreamEvent } from "../types"

/**
 * 事件订阅者函数签名
 *
 * 每个订阅者是一个回调函数，当事件发生时被调用
 */
type Subscriber = (event: StreamEvent) => void

/**
 * 活跃任务结构
 *
 * 代表一个正在运行或刚完成的流式任务
 */
export type ActiveTask = {
  id: string // 任务唯一标识符
  sessionId: string // 关联的会话 ID
  status: "streaming" | "completed" | "failed" | "cancelled" // 任务状态
  content: string // 已累积的代理回复内容
  errorMessage: string | null // 错误信息（仅 failed 状态）
  messageId: number | null // 关联的消息 ID（仅 completed 状态）
  subscribers: Set<Subscriber> // 事件订阅者集合
  abortController: AbortController // 用于取消任务的控制器
  completed: boolean // 是否已完成（状态标志）
}

// ============ 内存数据结构 ============

/**
 * 任务注册表：streamId → ActiveTask
 *
 * 存储所有流式任务的运行时数据
 */
const tasks = new Map<string, ActiveTask>()

/**
 * 会话索引：sessionId → streamId
 *
 * 用于快速查找指定会话的当前活跃任务
 * 保证同一会话同时只有一个活跃任务
 */
const sessionIndex = new Map<string, string>()

// ============ 清理机制 ============

/**
 * 任务存活时间：5分钟
 *
 * 任务完成后，将在内存中保留此时间以供重连恢复
 * 超过此时间后将被清理
 */
const TASK_TTL_MS = 5 * 60 * 1000

/**
 * 清理过期的已完成任务
 *
 * 从会话索引和任务注册表中移除超过 TTL 的已完成任务
 * 定时触发，不在每次操作时执行
 */
function cleanup(): void {
  const now = Date.now()
  for (const [id, task] of tasks) {
    // 只清理已完成且超过 TTL 的任务
    if (task.completed && now - parseTimestamp(task.id) > TASK_TTL_MS) {
      task.subscribers.clear()
      tasks.delete(id)
      // 同时清理会话索引
      if (sessionIndex.get(task.sessionId) === id) {
        sessionIndex.delete(task.sessionId)
      }
    }
  }
}

/**
 * 从任务 ID 中解析时间戳
 *
 * 用于判断任务创建时间，辅助 TTL 清理
 *
 * @param id nanoid 生成的任务 ID
 * @returns 解析出的时间戳（毫秒）
 */
function parseTimestamp(id: string): number {
  return parseInt(id.replace(/[^0-9]/g, ""), 36) || 0
}

// ============ 任务管理 ============

/**
 * 创建新的流任务
 *
 * 防并发机制：
 * - 检查会话索引，如果已有活跃任务则拒绝创建
 * - 如果任务已 completed，则允许创建新任务
 *
 * @param streamId 任务 ID
 * @param sessionId 会话 ID
 * @param abortController 取消控制器
 * @returns 创建的任务，或 null（已有活跃任务时）
 */
export function createTask(
  streamId: string,
  sessionId: string,
  abortController: AbortController
): ActiveTask | null {
  // 检查是否已有活跃任务
  const existing = sessionIndex.get(sessionId)
  if (existing) {
    const existingTask = tasks.get(existing)
    // 如果任务仍在运行，拒绝创建新任务
    if (existingTask && !existingTask.completed) {
      return null
    }
    // 清理已过期的索引
    sessionIndex.delete(sessionId)
  }

  // 创建新任务
  const task: ActiveTask = {
    id: streamId,
    sessionId,
    status: "streaming",
    content: "",
    errorMessage: null,
    messageId: null,
    subscribers: new Set(),
    abortController,
    completed: false,
  }

  // 注册到索引
  tasks.set(streamId, task)
  sessionIndex.set(sessionId, streamId)

  return task
}

/**
 * 根据任务 ID 获取任务
 *
 * @param streamId 任务 ID
 * @returns 任务对象，不存在时返回 undefined
 */
export function getTask(streamId: string): ActiveTask | undefined {
  return tasks.get(streamId)
}

/**
 * 获取指定会话的活跃任务
 *
 * 用途：检查会话是否有正在运行的流
 *
 * @param sessionId 会话 ID
 * @returns 活跃任务，没有则返回 undefined
 */
export function getActiveTaskForSession(
  sessionId: string
): ActiveTask | undefined {
  const streamId = sessionIndex.get(sessionId)
  if (!streamId) return undefined

  const task = tasks.get(streamId)
  // 如果任务已完成或不存在，清理索引并返回 undefined
  if (!task || task.completed) {
    sessionIndex.delete(sessionId)
    return undefined
  }
  return task
}

// ============ 事件订阅 ============

/**
 * 订阅指定任务的事件
 *
 * @param streamId 任务 ID
 * @param subscriber 订阅者回调函数
 * @returns 是否成功订阅
 */
export function subscribe(streamId: string, subscriber: Subscriber): boolean {
  const task = tasks.get(streamId)
  if (!task) return false
  task.subscribers.add(subscriber)
  return true
}

/**
 * 取消订阅指定任务的事件
 *
 * @param streamId 任务 ID
 * @param subscriber 订阅者回调函数
 */
export function unsubscribe(streamId: string, subscriber: Subscriber): void {
  const task = tasks.get(streamId)
  if (task) {
    task.subscribers.delete(subscriber)
  }
}

// ============ 事件广播 ============

/**
 * 向所有订阅者广播事件
 *
 * 执行逻辑：
 * 1. 如果没有订阅者，输出警告日志
 * 2. 遍历所有订阅者，调用其回调函数
 * 3. 如果订阅者抛出异常，从集合中移除
 *
 * @param task 任务对象
 * @param event 要广播的事件
 */
export function broadcast(task: ActiveTask, event: StreamEvent): void {
  for (const sub of task.subscribers) {
    try {
      sub(event)
    } catch {
      // 移除出错的订阅者，避免影响其他订阅者
      task.subscribers.delete(sub)
    }
  }
}

// ============ 任务状态管理 ============

/**
 * 标记任务为已完成
 *
 * 执行逻辑：
 * 1. 更新任务状态和消息 ID
 * 2. 清空订阅者集合（不再需要推送事件）
 * 3. 定时清理过期任务
 *
 * @param streamId 任务 ID
 * @param messageId 关联的消息 ID
 */
export function completeTask(streamId: string, messageId: number | null): void {
  const task = tasks.get(streamId)
  if (!task) return

  task.status = "completed"
  task.completed = true
  task.messageId = messageId
  task.subscribers.clear()

  // 延迟清理，保留一段时间以供重连恢复
  setTimeout(cleanup, TASK_TTL_MS)
}

/**
 * 标记任务为失败
 *
 * 执行逻辑：
 * 1. 更新任务状态和错误信息
 * 2. 广播错误事件给所有订阅者
 * 3. 清空订阅者集合
 * 4. 定时清理过期任务
 *
 * @param streamId 任务 ID
 * @param errorMessage 错误信息
 */
export function failTask(streamId: string, errorMessage: string): void {
  const task = tasks.get(streamId)
  if (!task) return

  task.status = "failed"
  task.completed = true
  task.errorMessage = errorMessage

  // 先广播错误事件，再清理订阅者
  broadcast(task, { type: "error", message: errorMessage, streamId })
  task.subscribers.clear()

  // 延迟清理
  setTimeout(cleanup, TASK_TTL_MS)
}

/**
 * 取消任务
 *
 * 执行逻辑：
 * 1. 检查任务是否存在且未完成
 * 2. 更新任务状态
 * 3. 调用 abortController.abort() 取消后台任务
 * 4. 广播取消事件给所有订阅者
 * 5. 清空订阅者集合
 * 6. 定时清理过期任务
 *
 * @param streamId 任务 ID
 * @returns 是否成功取消
 */
export function cancelTask(streamId: string): boolean {
  const task = tasks.get(streamId)
  // 任务不存在或已完成，无法取消
  if (!task || task.completed) return false

  task.status = "cancelled"
  task.completed = true

  // 取消后台运行的 agent 任务
  task.abortController.abort()

  // 广播取消事件
  broadcast(task, { type: "cancelled", streamId })
  task.subscribers.clear()

  // 延迟清理
  setTimeout(cleanup, TASK_TTL_MS)
  return true
}
