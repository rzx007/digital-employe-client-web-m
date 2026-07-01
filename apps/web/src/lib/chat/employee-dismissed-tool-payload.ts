import {
  isBatchMutationAllFailed,
  isToolOutputPending,
} from "./tool-output-pending"
import { asNumber, parseJsonObject } from "./parse-utils"

export interface EmployeesDismissedSucceededItem {
  index: number
  employee_id: number
  employee_name: string
}

export interface EmployeesDismissedFailedItem {
  index: number
  employee_id?: number
  error: string
}

export interface EmployeesDismissedPayload {
  type: "employees_dismissed"
  total: number
  succeeded_count: number
  failed_count: number
  succeeded: EmployeesDismissedSucceededItem[]
  failed: EmployeesDismissedFailedItem[]
  message?: string
}

function normalizeSucceeded(
  raw: unknown
): EmployeesDismissedSucceededItem | null {
  if (!raw || typeof raw !== "object") return null
  const item = raw as Record<string, unknown>
  const employeeId = asNumber(item.employee_id)
  if (employeeId == null) return null
  return {
    index: asNumber(item.index) ?? 0,
    employee_id: employeeId,
    employee_name:
      typeof item.employee_name === "string" ? item.employee_name : "",
  }
}

function normalizeFailed(raw: unknown): EmployeesDismissedFailedItem | null {
  if (!raw || typeof raw !== "object") return null
  const item = raw as Record<string, unknown>
  const error = typeof item.error === "string" ? item.error : ""
  if (!error) return null
  const employeeId = asNumber(item.employee_id)
  return {
    index: asNumber(item.index) ?? 0,
    employee_id: employeeId ?? undefined,
    error,
  }
}

export function parseEmployeesDismissedPayload(
  text: string | null | undefined
): EmployeesDismissedPayload | null {
  if (!text?.trim()) return null
  const obj = parseJsonObject(text)
  if (!obj || obj.type !== "employees_dismissed") return null

  const succeeded = Array.isArray(obj.succeeded)
    ? obj.succeeded
        .map(normalizeSucceeded)
        .filter((item): item is EmployeesDismissedSucceededItem => item != null)
    : []
  const failed = Array.isArray(obj.failed)
    ? obj.failed
        .map(normalizeFailed)
        .filter((item): item is EmployeesDismissedFailedItem => item != null)
    : []

  const total = asNumber(obj.total) ?? succeeded.length + failed.length
  const succeededCount = asNumber(obj.succeeded_count) ?? succeeded.length
  const failedCount = asNumber(obj.failed_count) ?? failed.length

  return {
    type: "employees_dismissed",
    total,
    succeeded_count: succeededCount,
    failed_count: failedCount,
    succeeded,
    failed,
    message: typeof obj.message === "string" ? obj.message : undefined,
  }
}

export function isEmployeeDismissToolRunning(
  state: string,
  preliminary?: boolean
): boolean {
  return isToolOutputPending(state, preliminary)
}

export { isBatchMutationAllFailed as isEmployeesDismissedAllFailed }

export function isEmployeeDismissPlainError(
  resultText: string | null | undefined
): boolean {
  const text = resultText?.trim()
  if (!text) return false
  return !text.startsWith("{")
}

export function shouldRenderEmployeesDismissedBlock(
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
    (!pending && isEmployeeDismissPlainError(resultText))
  )
}

export function resolveEmployeesDismissedBlockKind(
  toolName: string,
  state: string,
  resultText: string | null | undefined,
  preliminary?: boolean
): "employees-dismissed" | null {
  if (toolName !== "delete_employees_batch") return null
  const payload = parseEmployeesDismissedPayload(resultText)
  if (
    shouldRenderEmployeesDismissedBlock(
      state,
      resultText,
      payload != null,
      preliminary
    )
  ) {
    return "employees-dismissed"
  }
  return null
}
