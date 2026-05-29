export interface PlanTaskPreview {
  task_id?: number
  employee_id?: number
  employee_name?: string
  task_name: string
  cron?: string | null
  execute_mode?: string
}

function isPlanTaskPreview(value: unknown): value is PlanTaskPreview {
  return (
    typeof value === "object" &&
    value != null &&
    typeof (value as PlanTaskPreview).task_name === "string"
  )
}

export function parsePlanTasksFromInput(input: unknown): PlanTaskPreview[] {
  if (!input || typeof input !== "object") return []
  const tasksRaw = (input as Record<string, unknown>).tasks

  if (Array.isArray(tasksRaw)) {
    return tasksRaw.filter(isPlanTaskPreview)
  }

  if (typeof tasksRaw !== "string" || !tasksRaw.trim()) return []

  try {
    const parsed: unknown = JSON.parse(tasksRaw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isPlanTaskPreview)
  } catch {
    return []
  }
}
