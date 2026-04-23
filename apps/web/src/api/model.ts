import { getConfigKv } from "./config-kv"

export interface RuntimeModelConfig {
  model: string
  base_url: string
  api_key_present: boolean
}

export async function fetchRuntimeModelConfig(): Promise<RuntimeModelConfig> {
  const [modelKv, baseUrlKv, apiKeyKv] = await Promise.all([
    getConfigKv("deepagent_model"),
    getConfigKv("base_url"),
    getConfigKv("open_ai_key"),
  ])

  return {
    model: modelKv?.config_value || "qwen2.5-72b-instruct",
    base_url:
      baseUrlKv?.config_value ||
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    api_key_present: Boolean(apiKeyKv?.config_value),
  }
}
