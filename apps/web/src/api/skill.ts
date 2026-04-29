import { request } from "@/lib/request"
import type { ApiResponse, LocalSkillDetail, LocalSkillImportResult, LocalSkillItem } from "./types"

export interface SkillItem {
  id: string | number
  name: string
  description: string
  version: string
  source: "private" | "marketplace"
  enabled: boolean
  has_mcp: boolean
  created_at?: string
  updated_at?: string
}

export async function fetchAvailableSkills(): Promise<SkillItem[]> {
  const res = await request<{ code?: number; data?: SkillItem[] }>(
    "/digital/api/v1/skills/available"
  )
  return Array.isArray(res?.data) ? res.data : []
}

export async function fetchMySkills(): Promise<SkillItem[]> {
  const res = await request<{ code?: number; data?: SkillItem[] }>(
    "/digital/api/v1/skills/my"
  )
  return Array.isArray(res?.data) ? res.data : []
}

export async function fetchLocalSkillList(): Promise<LocalSkillItem[]> {
  const res = await request<ApiResponse<LocalSkillItem[]>>(
    "/skills/local/list"
  )
  return Array.isArray(res?.data) ? res.data : []
}

export async function fetchLocalSkillDetail(
  skillName: string
): Promise<LocalSkillDetail> {
  const res = await request<ApiResponse<LocalSkillDetail>>(
    `/skills/local/${encodeURIComponent(skillName)}`
  )
  return res.data
}

export async function importLocalSkill(params: {
  skillName: string
  directoryId?: number
  file: File
  overwrite?: boolean
}): Promise<LocalSkillImportResult> {
  const formData = new FormData()
  formData.append("skillName", params.skillName)
  if (params.directoryId != null) {
    formData.append("directoryId", String(params.directoryId))
  }
  formData.append("file", params.file)
  if (params.overwrite) {
    formData.append("overwrite", "true")
  }
  const res = await request<ApiResponse<LocalSkillImportResult>>(
    "/skills/local/import",
    {
      method: "POST",
      body: formData,
    }
  )
  return res.data
}

export async function checkLocalSkillNameExists(
  skillName: string
): Promise<boolean> {
  const res = await request<ApiResponse<{ exists: boolean }>>(
    "/skills/local/name/exists",
    {
      method: "POST",
      body: { skillName },
    }
  )
  return res.data?.exists ?? false
}

export async function uploadLocalSkillToRemote(params: {
  skillName: string
  directoryId?: number
  displayNameZh?: string
}): Promise<unknown> {
  const formData = new FormData()
  if (params.directoryId != null) {
    formData.append("directoryId", String(params.directoryId))
  }
  if (params.displayNameZh) {
    formData.append("displayNameZh", params.displayNameZh)
  }
  const res = await request<ApiResponse<unknown>>(
    `/skills/local/${encodeURIComponent(params.skillName)}/remote-import`,
    {
      method: "POST",
      body: formData,
    }
  )
  return res.data
}
