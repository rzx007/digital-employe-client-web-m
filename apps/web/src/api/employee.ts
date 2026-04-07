import { request } from "@/lib/request"
import type { ApiResponse, Employee } from "./types"

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
