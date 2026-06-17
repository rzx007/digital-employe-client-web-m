export type TaskRunStatus =
  | "success"
  | "failed"
  | "pending"
  | "queued"
  | "running"
  | "timeout"
  | "stuck"
  | "cancelled"
  | "superseded"

/** 未终态（仍在进行/排队/卡住）的任务执行状态集合——员工任务面板与「N 个在执行」指示共用，避免漂移。 */
export const ACTIVE_TASK_RUN_STATUSES: ReadonlySet<TaskRunStatus> = new Set([
  "running",
  "queued",
  "pending",
  "stuck",
])

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
  content: string
}
export interface SkillRatingOutput {
  id: number
  skill_id: number
  skill_name: string
  score: number
  comment: string
  created_at: string
}
export interface TaskExecution {
  id: number
  task_id: number
  employee_name: string
  workspace_id: number
  employee_id: number
  skill_id: number
  conversation_id: number | null
  orchestrator_conversation_id?: number | null
  task_name: string
  run_status: TaskRunStatus
  run_result: string | null
  error_message: string | null
  input: Record<string, unknown>
  output: TaskExecutionOutput
  started_at: string
  ended_at: string | null
  duration_ms: number | null
  /** 运行中保活时间戳（每 ~30s 刷新）；用于判断「还活着」vs「卡死」。 */
  last_heartbeat_at?: string | null
  /** 该执行被总管打回后重新派发的次数（0 或 undefined 表示从未返工）。 */
  rework_count?: number
  skill_rating: null | SkillRatingOutput
  confirm_url: string | null
  confirm_execution_result: boolean
  result_confirmed: boolean
  is_read: boolean
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

export interface ExecutionMetrics7d {
  days: number
  start_at: string
  end_at: string
  total_finished: number
  success: number
  failed: number
  timeout: number
  cancelled: number
  failure_count: number
  failure_rate: number | null
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

export interface TodayTask {
  task_id: number
  task_name: string
  employee_id: number
  employee_name: string
  cron_expression: string | null
  execute_mode: string
  planned_at: string | null
  execution_id: number | null
  run_status: TaskRunStatus
  run_result: string | null
  started_at: string | null
  ended_at: string | null
  duration_ms: number | null
  conversation_id: number | null
}

export interface ToolFootprint {
  tool_count: number
  /** 工具 parts(ToolUIPart 形态),交前端 classifier → ToolGroupBlock 渲染 */
  parts: Record<string, unknown>[]
}
