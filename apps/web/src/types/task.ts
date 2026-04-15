export type CronExpressionType = "daily" | "weekdays" | "weekends" | "loop"

export type TaskResourceType = "mcp" | "skill"

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

export interface ShiftScheduleForm {
  start_date?: string
  end_date?: string
  status: number
  notes?: string
}
