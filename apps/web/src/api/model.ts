import { request } from "@/lib/request"
import { getConfigKv } from "./config-kv"
import type { ApiResponse } from "./types"

export const CUSTOM_PROVIDER_ID = "custom"

export interface LlmProviderCatalogItem {
  id: string
  display_name: string
  base_url: string
  default_models: string[]
  suggested_max_input_tokens?: number | null
}

export interface RuntimeModelConfig {
  model: string
  base_url: string
  api_key_present: boolean
  provider_id?: string | null
}

export interface TestLlmConnectionPayload {
  provider_id?: string | null
  base_url?: string
  api_key?: string
  model?: string
}

export interface TestLlmConnectionResult {
  ok: boolean
  provider_id: string
  normalized_base_url: string
  model: string
  message: string
}

export async function fetchLlmProviders(): Promise<LlmProviderCatalogItem[]> {
  const res = await request<ApiResponse<LlmProviderCatalogItem[]>>(
    "/model/providers"
  )
  return res.data ?? []
}

export async function testLlmConnection(
  payload: TestLlmConnectionPayload
): Promise<TestLlmConnectionResult> {
  const res = await request<ApiResponse<TestLlmConnectionResult>>(
    "/model/test-connection",
    {
      method: "POST",
      body: payload,
    }
  )
  if (!res.data) {
    throw new Error(res.msg || "连接测试失败")
  }
  return res.data
}

export async function fetchRuntimeModelConfig(): Promise<RuntimeModelConfig> {
  const [modelKv, baseUrlKv, apiKeyKv, providerKv] = await Promise.all([
    getConfigKv("DEEPAGENT_MODEL"),
    getConfigKv("BASE_URL"),
    getConfigKv("OPENAI_API_KEY"),
    getConfigKv("LLM_PROVIDER"),
  ])

  return {
    model: modelKv?.config_value || "qwen2.5-72b-instruct",
    base_url:
      baseUrlKv?.config_value ||
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    api_key_present: Boolean(apiKeyKv?.config_value),
    provider_id: providerKv?.config_value || null,
  }
}
