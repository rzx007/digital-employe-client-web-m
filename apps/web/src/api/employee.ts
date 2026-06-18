import { request } from "@/lib/request"
import { getActiveWorkspaceId } from "@/lib/workspace-id"
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

export async function fetchMcpList(): Promise<McpListItem[]> {
  const res = await request<{ code?: number; data?: McpListItem[] }>(
    "/mcp/list"
  )
  return Array.isArray(res?.data) ? res.data : []
}

export async function fetchSkillList(opts?: {
  signal?: AbortSignal
  localOnly?: boolean
}): Promise<SkillListItem[]> {
  const suffix = opts?.localOnly ? "?localOnly=true" : ""
  const res = await request<{ code?: number; data?: SkillListItem[] }>(
    `/skills/list${suffix}`,
    opts?.signal ? { signal: opts.signal } : {}
  )
  return Array.isArray(res?.data) ? res.data : []
}

/**
 * 查询员工列表
 * GET /workspaces/{workspace_id}/employees
 */
export async function fetchEmployees(opts?: { signal?: AbortSignal }) {
  return request<ApiResponse<Employee[]>>(
    `/workspaces/${getActiveWorkspaceId()}/employees`,
    opts?.signal ? { signal: opts.signal } : {}
  )
}

/** 上传/替换员工自定义头像（图片，multipart）。POST /employees/{id}/avatar */
export async function uploadEmployeeAvatar(employeeId: number, file: File) {
  const form = new FormData()
  form.append("file", file)
  return request<ApiResponse<Employee>>(`/employees/${employeeId}/avatar`, {
    method: "POST",
    body: form,
  })
}

/** 删除员工自定义头像，恢复为文字头像。DELETE /employees/{id}/avatar */
export async function deleteEmployeeAvatar(employeeId: number) {
  return request<ApiResponse<Employee>>(`/employees/${employeeId}/avatar`, {
    method: "DELETE",
  })
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
    timeout: 30000 * 6,
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
 * POST /workspaces/{workspace_id}/employees
 */
export async function createEmployee(
  params: CreateEmployeeParams
): Promise<ApiResponse<unknown>> {
  return request<ApiResponse<unknown>>(
    `/workspaces/${getActiveWorkspaceId()}/employees`,
    {
      method: "POST",
      body: buildEmployeeBody(params),
    }
  )
}

export interface EmployeeSkillCandidate {
  name: string
  zh: string
  description: string
}

export interface EmployeeGrowthBrain {
  profile_md: string
  skills_list: string[]
  memories_md: string
  journal_entries: Array<{
    ts: string
    task_name: string
    status: string
    duration_ms: number | null
  }>
  skill_candidates: EmployeeSkillCandidate[]
}

/**
 * 获取员工成长脑图数据
 * GET /employees/{employee_id}/growth/brain
 */
export async function fetchEmployeeGrowthBrain(
  employeeId: number | string,
  opts?: { signal?: AbortSignal }
) {
  return request<ApiResponse<EmployeeGrowthBrain>>(
    `/employees/${employeeId}/growth/brain`,
    opts?.signal ? { signal: opts.signal } : {}
  )
}

/**
 * 采纳技能候选 → 转为该员工正式技能
 * POST /employees/{employee_id}/growth/skill-candidates/{slug}/adopt
 */
export async function adoptSkillCandidate(
  employeeId: number | string,
  slug: string
) {
  return request<ApiResponse<{ adopted: string }>>(
    `/employees/${employeeId}/growth/skill-candidates/${encodeURIComponent(slug)}/adopt`,
    { method: "POST" }
  )
}

/**
 * 忽略技能候选 → 删除候选
 * POST /employees/{employee_id}/growth/skill-candidates/{slug}/dismiss
 */
export async function dismissSkillCandidate(
  employeeId: number | string,
  slug: string
) {
  return request<ApiResponse<{ dismissed: string }>>(
    `/employees/${employeeId}/growth/skill-candidates/${encodeURIComponent(slug)}/dismiss`,
    { method: "POST" }
  )
}

/**
 * 更新员工信息
 * PUT /workspaces/{workspace_id}/employees/{employee_id}
 */
export async function updateEmployee(
  employeeId: number | string,
  params: CreateEmployeeParams
): Promise<ApiResponse<unknown>> {
  return request<ApiResponse<unknown>>(
    `/workspaces/${getActiveWorkspaceId()}/employees/${employeeId}`,
    {
      method: "PUT",
      body: buildEmployeeBody(params),
    }
  )
}
