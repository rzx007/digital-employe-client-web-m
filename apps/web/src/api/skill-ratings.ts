import { request } from "@/lib/request"
import type { ApiResponse } from "@/api"

export interface SubmitSkillRatingParams {
  task_execution_log_id: number
  score: number
  comment: string
}

export async function submitSkillRating(params: SubmitSkillRatingParams) {
  return request<ApiResponse<null>>(`/skill-ratings`, {
    method: "POST",
    body: params,
  })
}
