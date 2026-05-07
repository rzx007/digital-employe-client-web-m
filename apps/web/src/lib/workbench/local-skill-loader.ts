import type { ApiResponse, MetadataSkill } from "@/api/types"
import { request } from "@/lib/request"

/**
 * Fetch skill details by skill name from local directory
 * Path: GET /local_employees/skills?…（开发环境由 request 拼到 /actus 代理）
 */
export async function fetchSkillDetails(
  employeeId: number | string,
  skillName: string,
  employeeName?: string
): Promise<MetadataSkill | null> {
  try {
    const params = new URLSearchParams()
    params.append("employee_id", String(employeeId))
    if (employeeName) params.append("employee_name", employeeName)
    params.append("skill_name", skillName)

    const res = await request<ApiResponse<MetadataSkill>>(
      `/local_employees/skills?${params.toString()}`
    )
    return res.data
  } catch (e) {
    console.error(`Failed to fetch skill ${skillName} for employee ${employeeId}:`, e)
    return null
  }
}

/**
 * Fetch all skills for an employee from local directory
 * Path: GET /local_employees/skills?…
 */
export async function fetchEmployeeSkillsFromLocal(
  employeeId: number | string,
  employeeName?: string
): Promise<MetadataSkill[]> {
  try {
    const params = new URLSearchParams()
    params.append("employee_id", String(employeeId))
    if (employeeName) params.append("employee_name", employeeName)

    const res = await request<ApiResponse<MetadataSkill[]>>(
      `/local_employees/skills?${params.toString()}`
    )
    return res.data
  } catch (e) {
    console.error(`Failed to fetch skills for employee ${employeeId}:`, e)
    return []
  }
}
