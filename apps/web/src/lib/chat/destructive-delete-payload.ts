import { asNumber } from "./parse-utils"

export interface DestructiveDeletePreview {
  toolName: string
  title: string
  detailLines: string[]
}

function parseIdList(raw: unknown): number[] {
  if (typeof raw !== "string" || !raw.trim()) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => asNumber(item))
      .filter((item): item is number => item != null)
  } catch {
    return []
  }
}

function parseStringList(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item): item is string => item.length > 0)
  } catch {
    return []
  }
}

export function buildDestructiveDeletePreview(
  toolName: string,
  input: unknown
): DestructiveDeletePreview | null {
  if (!input || typeof input !== "object") return null
  const record = input as Record<string, unknown>

  if (toolName === "delete_employee") {
    const employeeId = asNumber(record.employee_id)
    if (employeeId == null) return null
    return {
      toolName,
      title: "解聘数字员工",
      detailLines: [`员工 ID：${employeeId}`],
    }
  }

  if (toolName === "delete_employees_batch") {
    const employeeIds = parseIdList(record.employee_ids)
    if (employeeIds.length === 0) return null
    return {
      toolName,
      title: "批量解聘数字员工",
      detailLines: employeeIds.map((id) => `员工 ID：${id}`),
    }
  }

  if (toolName === "delete_task") {
    const taskId = asNumber(record.task_id)
    if (taskId == null) return null
    return {
      toolName,
      title: "删除子任务",
      detailLines: [`任务 ID：#${taskId}`],
    }
  }

  if (toolName === "delete_tasks_batch") {
    const taskIds = parseIdList(record.task_ids)
    if (taskIds.length === 0) return null
    return {
      toolName,
      title: "批量删除子任务",
      detailLines: taskIds.map((id) => `任务 ID：#${id}`),
    }
  }

  if (toolName === "delete_workspace_skill") {
    const skillName =
      typeof record.skill_name === "string" ? record.skill_name.trim() : ""
    if (!skillName) return null
    return {
      toolName,
      title: "删除工作区技能",
      detailLines: [`技能：${skillName}`],
    }
  }

  if (toolName === "delete_workspace_skills_batch") {
    const skillNames = parseStringList(record.skill_names)
    if (skillNames.length === 0) return null
    return {
      toolName,
      title: "批量删除工作区技能",
      detailLines: skillNames.map((name) => `技能：${name}`),
    }
  }

  return null
}

export function isDestructiveDeletePendingState(state?: string): boolean {
  return (
    state === "call" ||
    state === "input-streaming" ||
    state === "input-available"
  )
}
