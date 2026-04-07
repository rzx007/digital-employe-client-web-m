export type TaskRunStatus =
  | "success"
  | "failed"
  | "pending"
  | "running"
  | "timeout"
  | "stuck"

export type AnomalyType = "timeout" | "error" | "duplicate" | "stuck"

export interface TaskRun {
  id: string
  taskId: string
  taskName: string
  employeeId: string
  cronExpression: string
  cronDescription: string
  status: TaskRunStatus
  triggeredAt: string
  completedAt: string | null
  duration: number | null
  result: string | null
  log: string | null
}

export interface ScheduleTask {
  capability_id: number
  is_active: boolean
  task_type: number
  task_id: number
  task_name: string
  employee_id: number
  employee_name: string
  cron_expression: string
  cron_description: string
  cron_expression_type: string
}

export interface EmployeeScheduleTask {
  id: number
  workspace_id: number
  employee_id: number
  employee_name_snapshot: string
  task_name: string
  dispatch_type: string
  skill_id: number
  capability_id: number
  priority: number
  task_type: number
  cron_expression: string
  cron_expression_type: string
  is_active: boolean
  task_input: Record<string, unknown>
  next_run_at: string
  last_run_at: string
  created_at: string
  updated_at: string
}

export interface SkillResponse {
  messages?: string[]
  [key: string]: unknown
}

export interface TaskExecutionOutput {
  scene?: string
  prompt?: string
  skill_name?: string
  response?: SkillResponse
  [key: string]: unknown
}

export interface TaskExecution {
  id: number
  task_id: number
  employee_name: string
  workspace_id: number
  employee_id: number
  skill_id: number
  task_name: string
  run_status: TaskRunStatus
  run_result: string | null
  error_message: string | null
  input: Record<string, unknown>
  output: TaskExecutionOutput
  started_at: string
  ended_at: string | null
  duration_ms: number | null
}

export interface ShiftSchedule {
  start_date: string
  end_date: string
  status: number
  notes: string
}

export interface ScheduleEmployee {
  employee_id: number
  employee_name: string
  tasks: ScheduleTask[]
  shift_id: number
  shift_name: string
  shift_schedule: ShiftSchedule
}

export interface ScheduleDay {
  day: number
  date: string
  total: number
  employees: ScheduleEmployee[]
}

export interface AnomalyRecord {
  id: string
  taskRunId: string
  taskName: string
  type: AnomalyType
  message: string
  occurredAt: string
  resolved: boolean
}

export interface MonthlyOverview {
  year: number
  month: number
  days: Record<string, ScheduleDay>
}

export interface TaskSummary {
  total: number
  completed: number
  failed: number
  pending: number
}
