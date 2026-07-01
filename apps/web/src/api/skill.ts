import { request } from "@/lib/request"
import type {
  ApiResponse,
  LocalSkillDetail,
  LocalSkillImportResult,
  LocalSkillItem,
} from "./types"

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
  const res = await request<ApiResponse<LocalSkillItem[]>>("/skills/local/list")
  return Array.isArray(res?.data) ? res.data : []
}

export async function fetchLocalSkillDetail(
  skillName: string,
  opts?: { signal?: AbortSignal }
): Promise<LocalSkillDetail> {
  const res = await request<ApiResponse<LocalSkillDetail>>(
    `/skills/local/${encodeURIComponent(skillName)}`,
    opts?.signal ? { signal: opts.signal } : {}
  )
  return res.data
}

export async function importLocalSkill(params: {
  skillName: string
  directoryId?: number
  file: File
  overwrite?: boolean
  displayNameZh?: string
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
  if (params.displayNameZh?.trim()) {
    formData.append("displayNameZh", params.displayNameZh.trim())
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

export async function updateLocalSkill(
  skillName: string,
  payload: {
    displayNameZh?: string
    skillMdContent?: string
    // 仅对内置技能生效：
    //   "workspace" 复制到当前工作区再保存（不改全局内置）；
    //   "builtin" 直接覆盖全局内置（所有工作区共享）。
    target?: "workspace" | "builtin"
  }
): Promise<{
  skillName: string
  displayNameZh: string | null
  skillMdContent: string | null
  syncedEmployeeCount?: number
  // 保存后该技能是否仍位于全局内置目录（复制另存后为 false）。
  isBuiltin?: boolean
}> {
  const res = await request<
    ApiResponse<{
      skillName: string
      displayNameZh: string | null
      skillMdContent: string | null
      syncedEmployeeCount?: number
      isBuiltin?: boolean
    }>
  >(`/skills/local/${encodeURIComponent(skillName)}`, {
    method: "PATCH",
    body: payload,
  })
  return res.data
}

export async function updateLocalSkillDisplayName(
  skillName: string,
  displayNameZh: string
): Promise<{ skillName: string; displayNameZh: string | null }> {
  const res = await updateLocalSkill(skillName, { displayNameZh })
  return {
    skillName: res.skillName,
    displayNameZh: res.displayNameZh,
  }
}

export async function deleteWorkspaceLocalSkill(
  skillName: string
): Promise<void> {
  await request<ApiResponse<null>>(
    `/skills/local/${encodeURIComponent(skillName)}`,
    {
      method: "DELETE",
    }
  )
}

export interface SaveDraftSkillResult {
  skillName: string
  localId: number
  employeeId: number
  overwritten: boolean
  attachedToEmployee: boolean
  attachError: string | null
}

export async function saveDraftSkill(params: {
  conversationId: number
  skillName: string
  employeeId: number
  overwrite?: boolean
  displayNameZh?: string
}): Promise<SaveDraftSkillResult> {
  const res = await request<ApiResponse<SaveDraftSkillResult>>(
    "/skills/local/save-draft",
    {
      method: "POST",
      body: {
        conversationId: params.conversationId,
        skillName: params.skillName,
        employeeId: params.employeeId,
        overwrite: params.overwrite ?? false,
        displayNameZh: params.displayNameZh,
      },
    }
  )
  return res.data
}

export async function installRemoteSkillToLocal(
  skillId: number,
  opts?: { overwrite?: boolean }
): Promise<LocalSkillImportResult> {
  const q = opts?.overwrite ? "?overwrite=true" : ""
  const res = await request<ApiResponse<LocalSkillImportResult>>(
    `/skills/remote/${skillId}/install${q}`,
    {
      method: "POST",
    }
  )
  return res.data
}
