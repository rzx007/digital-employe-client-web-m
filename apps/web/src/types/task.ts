export type CronExpressionType = "daily" | "weekdays" | "weekends" | "loop"

export type TaskResourceType = "mcp" | "skill"

export type EmployeeTaskSource = "manual" | "orchestration"

export interface TaskFormData {
  id?: number
  task_name: string
  user_prompt: string
  task_resource_type: TaskResourceType
  capability_id: number
  skill_id: number
  task_type: number
  cron_expression: string
  cron_expression_type: CronExpressionType
  is_active: boolean
  excludedDates?: string[]
  executeTime?: string
  confirm_execution_result?: boolean
}

export type ScheduleTaskListItem = TaskFormData & {
  source?: EmployeeTaskSource | string
}

/** 员工元数据 / 接口返回的任务条目（读） */
export interface ApiEmployeeTaskRead {
  id?: number
  task_name: string
  dispatch_type?: string
  capability_id: number
  skill_id: number
  priority?: number
  task_type: number
  cron_expression: string
  cron_expression_type: string
  is_active: boolean
  confirm_execution_result?: boolean
  config?: Record<string, unknown>
  user_prompt: string
  source?: string
}

export function parseEmployeeTaskSource(
  raw: string | null | undefined
): EmployeeTaskSource | string | undefined {
  if (raw == null || raw === "") return undefined
  const low = raw.toLowerCase()
  if (low === "manual") return "manual"
  if (low === "orchestration") return "orchestration"
  return raw
}

export function convertApiEmployeeTasksToListItems(
  apiTasks: ApiEmployeeTaskRead[] | undefined | null
): ScheduleTaskListItem[] {
  if (!apiTasks?.length) return []
  return apiTasks.map((t) => ({
    id: t.id,
    task_name: t.task_name,
    user_prompt: t.user_prompt,
    task_resource_type: (t.dispatch_type as TaskResourceType) || "skill",
    capability_id: t.capability_id,
    skill_id: t.skill_id,
    task_type: t.task_type ?? 2,
    cron_expression: t.cron_expression,
    cron_expression_type:
      (t.cron_expression_type as CronExpressionType) || "daily",
    is_active: t.is_active ?? true,
    confirm_execution_result: t.confirm_execution_result ?? false,
    source: parseEmployeeTaskSource(t.source) ?? "manual",
  }))
}

export function scheduleTaskListItemToFormData(
  item: ScheduleTaskListItem
): TaskFormData {
  const { source, ...rest } = item
  void source
  return rest
}

export function tasksToApiPayload(
  items: ScheduleTaskListItem[]
): TaskFormData[] {
  return items.map((item) => {
    const { source, ...rest } = item
    void source
    return rest
  })
}

export interface ShiftScheduleForm {
  start_date?: string
  end_date?: string
  status: number
  notes?: string
}
