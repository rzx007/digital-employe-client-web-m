import { request } from "@/lib/request"

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
