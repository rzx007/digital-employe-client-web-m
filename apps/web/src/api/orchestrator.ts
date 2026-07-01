import { request } from "@/lib/request"
import type { ApiResponse } from "./types"

export interface OrchestratorSkill {
  name: string
  description: string
}

export async function fetchOrchestratorSkills(): Promise<OrchestratorSkill[]> {
  const res = await request<ApiResponse<OrchestratorSkill[]>>(
    "/chat/orchestrator/skills"
  )
  return Array.isArray(res?.data) ? res.data : []
}
