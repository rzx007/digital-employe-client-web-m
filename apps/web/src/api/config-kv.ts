import { request } from "@/lib/request"
import type { ApiResponse } from "./types"

export interface ConfigKvItem {
  id: number
  config_key: string
  config_value: string
  created_at: string
  updated_at: string
}

export async function getConfigKv(configKey: string): Promise<ConfigKvItem | null> {
  try {
    const res = await request<ApiResponse<ConfigKvItem>>(
      `/config-kvs/${encodeURIComponent(configKey)}`
    )
    return res.data
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response?.status
    if (status === 404) {
      return null
    }
    throw error
  }
}

export async function setConfigKv(
  configKey: string,
  configValue: string
): Promise<ConfigKvItem> {
  try {
    const res = await request<ApiResponse<ConfigKvItem>>(
      `/config-kvs/${encodeURIComponent(configKey)}`,
      {
        method: "PUT",
        body: { config_value: configValue },
      }
    )
    return res.data
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response?.status
    if (status !== 404) {
      throw error
    }
  }

  const res = await request<ApiResponse<ConfigKvItem>>("/config-kvs/create", {
    method: "POST",
    body: {
      config_key: configKey,
      config_value: configValue,
    },
  })
  return res.data
}

export async function setManyConfigKv(
  entries: Array<{ key: string; value: string }>
) {
  for (const entry of entries) {
    await setConfigKv(entry.key, entry.value)
  }
}
