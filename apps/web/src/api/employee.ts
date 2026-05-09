import { request } from "@/lib/request"
import type {
  ApiResponse,
  Capability,
  Employee,
  McpListItem,
  MetadataMcp,
  MetadataSkill,
  SkillListItem,
} from "./types"
import type { TaskFormData, ShiftScheduleForm } from "@/types/task"

/** 当前固定工作空间 ID */
const WORKSPACE_ID = 1

export async function fetchMcpList(): Promise<McpListItem[]> {
  const res = await request<{ code?: number; data?: McpListItem[] }>(
    "/mcp/list"
  )
  return Array.isArray(res?.data) ? res.data : []
}

export async function fetchSkillList(opts?: {
  signal?: AbortSignal
}): Promise<SkillListItem[]> {
  const res = await request<{ code?: number; data?: SkillListItem[] }>(
    "/skills/list",
    opts?.signal ? { signal: opts.signal } : {},
  )
  return Array.isArray(res?.data) ? res.data : []
}

/**
 * 导入员工列表并解析
 * GET /workspaces/{workspace_id}/employees/sync
 */
export async function syncEmployees() {
  return request<ApiResponse<null>>(
    `/workspaces/${WORKSPACE_ID}/employees/sync`
  )
}

/**
 * 查询员工列表
 * GET /workspaces/{workspace_id}/employees
 */
export async function fetchEmployees(opts?: { signal?: AbortSignal }) {
  return request<ApiResponse<Employee[]>>(
    `/workspaces/${WORKSPACE_ID}/employees`,
    opts?.signal ? { signal: opts.signal } : {},
  )
}

/**
 * 查询员工详情
 * GET /employees/{employee_id}
 */
export async function fetchEmployeeById(
  employeeId: number | string,
  opts?: { signal?: AbortSignal }
) {
  return request<ApiResponse<Employee>>(`/employees/${employeeId}`, {
    ...(opts?.signal ? { signal: opts.signal } : {}),
  })
}

/**
 * 删除员工
 * DELETE /employees/{employee_id}
 */
export async function deleteEmployee(employeeId: number | string) {
  return request<ApiResponse<null>>(`/employees/${employeeId}`, {
    method: "DELETE",
  })
}

export interface RecruitRequest {
  prompt: string
  count: number
}

export interface RecruitmentCandidate {
  id: number
  workspace_id: number | null
  employee_name: string
  capability_desc: string | null
  status: number
  detail_page_url: string | null
  created_at: string
  updated_at: string
  user_id: string | null
  mcp_ids: number[]
  skill_ids: number[]
  mcps: MetadataMcp[]
  skills: MetadataSkill[]
  shift_schedule: unknown | null
  tasks: unknown[]
  match_score?: number
}

/**
 * 获取招聘候选人列表
 *
 * @param params - 招聘请求参数，用于指定招聘条件和筛选标准
 * @returns 返回招聘候选人的数组，如果请求失败或数据格式不正确则返回空数组
 */
export async function fetchRecruitCandidates(
  params: RecruitRequest
): Promise<RecruitmentCandidate[]> {
  const body = await request<{
    code?: number
    msg?: string
    data?: RecruitmentCandidate[]
  }>("/generate-employees", {
    method: "POST",
    body: params,
  })
  return Array.isArray(body?.data) ? body.data : []
}

export interface CreateEmployeeParams {
  employee_name: string
  capability_desc?: string | null
  status?: number
  detail_page_url?: string | null
  mcp_ids?: number[]
  skill_ids?: number[]
  shift_schedule?: ShiftScheduleForm | null
  tasks?: TaskFormData[]
}

function buildEmployeeBody(
  params: CreateEmployeeParams
): Record<string, unknown> {
  const { shift_schedule, tasks, ...basic } = params

  const body: Record<string, unknown> = { ...basic }
  body.workspace_id = 1
  if (shift_schedule) {
    body.shift_schedule = shift_schedule
  }

  if (tasks && tasks.length > 0) {
    body.tasks = tasks.map((task) => ({
      id: task.id,
      task_name: task.task_name,
      capability_id: task.capability_id,
      task_type: task.task_type ?? 2,
      config: {},
      cron_expression: task.cron_expression || "",
      is_active: task.is_active ?? true,
      cron_expression_type: task.cron_expression_type || "daily",
      user_prompt: task.user_prompt,
      task_resource_type: task.task_resource_type,
      skill_id: task.skill_id,
      confirm_execution_result: task.confirm_execution_result ?? false,
    }))
  }

  return body
}

/**
 * 创建员工信息
 */
export async function createEmployee(
  params: CreateEmployeeParams
): Promise<ApiResponse<unknown>> {
  return request<ApiResponse<unknown>>("/employees/create", {
    method: "POST",
    body: buildEmployeeBody(params),
  })
}

/**
 * 更新员工信息
 * PUT /employees/{employee_id}
 */
export async function updateEmployee(
  employeeId: number | string,
  params: CreateEmployeeParams
): Promise<ApiResponse<unknown>> {
  return request<ApiResponse<unknown>>(`/employees/${employeeId}`, {
    method: "PUT",
    body: buildEmployeeBody(params),
  })
}
