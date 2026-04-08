import { request } from "@/lib/request"
import type { ApiResponse, Capability, Employee, MetadataSkill } from "./types"
import type { TaskFormData, ShiftScheduleForm } from "@/types/task"

/** 当前固定工作空间 ID */
const WORKSPACE_ID = 1

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
export async function fetchEmployees() {
  return request<ApiResponse<Employee[]>>(
    `/workspaces/${WORKSPACE_ID}/employees`
  )
}

/**
 * 查询员工详情
 * GET /employees/{employee_id}
 */
export async function fetchEmployeeById(employeeId: number | string) {
  return request<ApiResponse<Employee>>(`/employees/${employeeId}`)
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
  title: string
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
  capability_ids: number[]
  skill_ids: number[]
  capabilities: Capability[]
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
  capability_ids?: number[]
  skill_ids?: number[]
  skills?: MetadataSkill[]
  shift_schedule?: ShiftScheduleForm | null
  tasks?: TaskFormData[]
}

/**
 * 创建员工信息
 * @param params - 创建员工所需的参数对象，包含员工的基本信息和其他必要字段
 * @returns 返回API响应结果，包含操作状态和相关数据
 */
export async function createEmployee(
  params: CreateEmployeeParams
): Promise<ApiResponse<unknown>> {
  const { shift_schedule, tasks, skills, ...basic } = params

  const body: Record<string, unknown> = { ...basic }

  if (skills && skills.length > 0) {
    body.skills = skills
  }

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
    }))
  }

  return request<ApiResponse<unknown>>("/employees/create", {
    method: "POST",
    body,
  })
}
