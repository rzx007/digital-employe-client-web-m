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

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith("{")) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function normalizeSucceeded(
  raw: unknown
): TasksDeletedSucceededItem | null {
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

export function isTaskMutationToolRunning(state: string): boolean {
  return (
    state === "call" ||
    state === "input-streaming" ||
    state === "input-available"
  )
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
  hasParsedPayload: boolean
): boolean {
  return (
    hasParsedPayload ||
    isTaskMutationToolRunning(state) ||
    state === "output-error" ||
    isTaskMutationPlainError(resultText)
  )
}

export function resolveTasksDeletedBlockKind(
  toolName: string,
  state: string,
  resultText: string | null | undefined
): "tasks-deleted" | null {
  if (toolName !== "delete_tasks_batch") return null
  const payload = parseTasksDeletedPayload(resultText)
  if (shouldRenderTasksDeletedBlock(state, resultText, payload != null)) {
    return "tasks-deleted"
  }
  return null
}
