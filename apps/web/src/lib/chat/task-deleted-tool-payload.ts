import { isToolOutputPending } from "./tool-output-pending"
import { asNumber, parseJsonObject } from "./parse-utils"

export interface TasksDeletedSucceededItem {
  index: number
  task_id: number
  task_name: string
}

export interface TasksDeletedFailedItem {
  index: number
  task_id: number
  error: string
}

export interface TasksDeletedPayload {
  type: "tasks_deleted"
  total: number
  succeeded_count: number
  failed_count: number
  succeeded: TasksDeletedSucceededItem[]
  failed: TasksDeletedFailedItem[]
  message?: string
}

function normalizeSucceeded(raw: unknown): TasksDeletedSucceededItem | null {
  if (!raw || typeof raw !== "object") return null
  const item = raw as Record<string, unknown>
  const taskId = asNumber(item.task_id)
  if (taskId == null) return null
  return {
    index: asNumber(item.index) ?? 0,
    task_id: taskId,
    task_name: typeof item.task_name === "string" ? item.task_name : "",
  }
}

function normalizeFailed(raw: unknown): TasksDeletedFailedItem | null {
  if (!raw || typeof raw !== "object") return null
  const item = raw as Record<string, unknown>
  const taskId = asNumber(item.task_id)
  const error = typeof item.error === "string" ? item.error : ""
  if (taskId == null || !error) return null
  return {
    index: asNumber(item.index) ?? 0,
    task_id: taskId,
    error,
  }
}

export function parseTasksDeletedPayload(
  text: string | null | undefined
): TasksDeletedPayload | null {
  if (!text?.trim()) return null
  const obj = parseJsonObject(text)
  if (!obj || obj.type !== "tasks_deleted") return null

  const succeeded = Array.isArray(obj.succeeded)
    ? obj.succeeded
        .map(normalizeSucceeded)
        .filter((item): item is TasksDeletedSucceededItem => item != null)
    : []
  const failed = Array.isArray(obj.failed)
    ? obj.failed
        .map(normalizeFailed)
        .filter((item): item is TasksDeletedFailedItem => item != null)
    : []

  const total = asNumber(obj.total) ?? succeeded.length + failed.length
  const succeededCount = asNumber(obj.succeeded_count) ?? succeeded.length
  const failedCount = asNumber(obj.failed_count) ?? failed.length

  return {
    type: "tasks_deleted",
    total,
    succeeded_count: succeededCount,
    failed_count: failedCount,
    succeeded,
    failed,
    message: typeof obj.message === "string" ? obj.message : undefined,
  }
}

export function isTaskMutationToolRunning(
  state: string,
  preliminary?: boolean
): boolean {
  return isToolOutputPending(state, preliminary)
}

export function isTaskMutationPlainError(
  resultText: string | null | undefined
): boolean {
  const text = resultText?.trim()
  if (!text) return false
  return !text.startsWith("{")
}

export function shouldRenderTasksDeletedBlock(
  state: string,
  resultText: string | null | undefined,
  hasParsedPayload: boolean,
  preliminary?: boolean
): boolean {
  const pending = isToolOutputPending(state, preliminary)
  return (
    hasParsedPayload ||
    pending ||
    state === "output-error" ||
    (!pending && isTaskMutationPlainError(resultText))
  )
}

export function resolveTasksDeletedBlockKind(
  toolName: string,
  state: string,
  resultText: string | null | undefined,
  preliminary?: boolean
): "tasks-deleted" | null {
  if (toolName !== "delete_tasks_batch") return null
  const payload = parseTasksDeletedPayload(resultText)
  if (
    shouldRenderTasksDeletedBlock(
      state,
      resultText,
      payload != null,
      preliminary
    )
  ) {
    return "tasks-deleted"
  }
  return null
}
