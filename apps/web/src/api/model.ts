import { request } from "@/lib/request"
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

export interface LlmRegistryModel {
  id: string
  display_name?: string | null
}

export interface LlmRegistryProvider {
  id: string
  source: "builtin" | "custom"
  display_name: string
  base_url: string
  api_key_masked: string
  api_key_present: boolean
  models: LlmRegistryModel[]
}

export interface LlmRegistry {
  active_provider_id: string | null
  active_model_id: string | null
  providers: LlmRegistryProvider[]
}

export interface RegistryModelInput {
  id: string
  display_name?: string | null
}

export interface AddLlmProviderPayload {
  source: "preset" | "custom"
  catalog_id?: string
  provider_id?: string
  display_name?: string
  base_url?: string
  api_key?: string
  models?: RegistryModelInput[]
  set_as_active?: boolean
}

export interface UpdateLlmProviderPayload {
  display_name?: string
  base_url?: string
  api_key?: string
  api_key_unchanged?: boolean
  models?: RegistryModelInput[]
}

export function activeModelKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`
}

export function parseActiveModelKey(key: string): {
  providerId: string
  modelId: string
} | null {
  const idx = key.indexOf("::")
  if (idx <= 0) return null
  return {
    providerId: key.slice(0, idx),
    modelId: key.slice(idx + 2),
  }
}

export async function fetchLlmProviders(): Promise<LlmProviderCatalogItem[]> {
  const res = await request<ApiResponse<LlmProviderCatalogItem[]>>(
    "/model/providers"
  )
  return res.data ?? []
}

export async function fetchLlmRegistry(): Promise<LlmRegistry> {
  const res = await request<ApiResponse<LlmRegistry>>("/model/registry")
  if (!res.data) {
    throw new Error(res.msg || "加载模型注册表失败")
  }
  return res.data
}

export async function fetchAvailableCatalogIds(): Promise<string[]> {
  const res = await request<ApiResponse<string[]>>(
    "/model/registry/available-catalog"
  )
  return res.data ?? []
}

export async function addLlmProvider(
  payload: AddLlmProviderPayload
): Promise<LlmRegistry> {
  const res = await request<ApiResponse<LlmRegistry>>("/model/providers", {
    method: "POST",
    body: payload,
  })
  if (!res.data) {
    throw new Error(res.msg || "添加供应商失败")
  }
  return res.data
}

export async function updateLlmProvider(
  providerId: string,
  payload: UpdateLlmProviderPayload
): Promise<LlmRegistry> {
  const res = await request<ApiResponse<LlmRegistry>>(
    `/model/providers/${encodeURIComponent(providerId)}`,
    {
      method: "PUT",
      body: payload,
    }
  )
  if (!res.data) {
    throw new Error(res.msg || "更新供应商失败")
  }
  return res.data
}

export async function deleteLlmProvider(
  providerId: string
): Promise<LlmRegistry> {
  const res = await request<ApiResponse<LlmRegistry>>(
    `/model/providers/${encodeURIComponent(providerId)}`,
    { method: "DELETE" }
  )
  if (!res.data) {
    throw new Error(res.msg || "删除供应商失败")
  }
  return res.data
}

export async function setActiveLlmModel(
  providerId: string,
  modelId: string
): Promise<LlmRegistry> {
  const res = await request<ApiResponse<LlmRegistry>>("/model/active", {
    method: "PUT",
    body: { provider_id: providerId, model_id: modelId },
  })
  if (!res.data) {
    throw new Error(res.msg || "设置当前模型失败")
  }
  return res.data
}

export async function testLlmProvider(
  providerId: string,
  modelId?: string
): Promise<TestLlmConnectionResult> {
  const res = await request<ApiResponse<TestLlmConnectionResult>>(
    `/model/providers/${encodeURIComponent(providerId)}/test`,
    {
      method: "POST",
      body: modelId ? { model_id: modelId } : {},
    }
  )
  if (!res.data) {
    throw new Error(res.msg || "连接测试失败")
  }
  return res.data
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
  const res = await request<ApiResponse<RuntimeModelConfig>>(
    "/model/runtime-config"
  )
  if (!res.data) {
    throw new Error(res.msg || "加载运行时模型配置失败")
  }
  return res.data
}

export interface SyncFromRemoteResult {
  synced: boolean
  registry: LlmRegistry
}

export async function syncModelFromRemote(): Promise<SyncFromRemoteResult> {
  const res = await request<ApiResponse<SyncFromRemoteResult>>(
    "/model/sync-from-remote",
    { method: "POST" }
  )
  if (!res.data?.registry) {
    throw new Error(res.msg || "同步平台模型配置失败")
  }
  return res.data
}
