import { request } from "@/lib/request"
import type { ApiResponse } from "./types"

export interface RuntimeModelConfig {
  model: string
  base_url: string
  api_key_present: boolean
}

export async function fetchRuntimeModelConfig(): Promise<RuntimeModelConfig> {
  const res = await request<ApiResponse<RuntimeModelConfig>>(
    "/runtime/model-config"
  )
  return res.data
}
