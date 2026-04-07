import type { ApiResponse, MetadataSkill } from "@/api/types"
import { request } from "@/lib/request"

/**
 * Fetch skill details by skill name from local directory
 * Path: GET /actus/local_employees/skills?employee_name=xxx&skill_name=xxx
 */
export async function fetchSkillDetails(
  employeeName: string,
  skillName: string
): Promise<MetadataSkill | null> {
  try {
    const res = await request<ApiResponse<MetadataSkill>>(
      `/actus/local_employees/skills?employee_name=${encodeURIComponent(employeeName)}&skill_name=${encodeURIComponent(skillName)}`
    )
    return res.data
  } catch (e) {
    console.error(`Failed to fetch skill ${skillName} for ${employeeName}:`, e)
    return null
  }
}

/**
 * Fetch all skills for an employee from local directory
 * Path: GET /actus/local_employees/skills?employee_name=xxx
 */
export async function fetchEmployeeSkillsFromLocal(
  employeeName: string
): Promise<MetadataSkill[]> {
  try {
    const res = await request<ApiResponse<MetadataSkill[]>>(
      `/actus/local_employees/skills?employee_name=${encodeURIComponent(employeeName)}`
    )
    return res.data
  } catch (e) {
    console.error(`Failed to fetch skills for ${employeeName}:`, e)
    return []
  }
}
