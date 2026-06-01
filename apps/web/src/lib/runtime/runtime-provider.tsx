import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { fetchRuntimeConfig } from "@/api/system"
import type { AgentRuntime, Capabilities, RuntimeConfig } from "./runtime-types"

const defaultCapabilities: Capabilities = {
  remote_login: true,
  remote_model_sync: true,
  remote_skills: true,
  remote_mcp: true,
  remote_performance: true,
  dispatch_order_sync: true,
  oauth: true,
  feishu_platform: true,
  skill_rating_upload: true,
  mcp_task_execution: true,
  activation_enforced: false,
}

const defaultRuntimeConfig: RuntimeConfig = {
  offline_mode: false,
  agent_runtime: {
    serial_mode: false,
    max_concurrent_streams: 0,
    active_streams: 0,
    queued_starts: 0,
  },
  capabilities: defaultCapabilities,
}

export let runtimeCapabilities: Capabilities = defaultCapabilities
export let isOfflineModeFlag = false

const RuntimeContext = React.createContext<RuntimeConfig>(defaultRuntimeConfig)

export function RuntimeProvider({ children }: { children: React.ReactNode }) {
  const { data } = useQuery({
    queryKey: ["system", "runtime"],
    queryFn: fetchRuntimeConfig,
    staleTime: Infinity,
  })

  const config = data?.data || defaultRuntimeConfig

  React.useEffect(() => {
    if (data?.data) {
      runtimeCapabilities = data.data.capabilities
      isOfflineModeFlag = data.data.offline_mode
    }
  }, [data])

  return (
    <RuntimeContext.Provider value={config}>{children}</RuntimeContext.Provider>
  )
}

export function useRuntimeConfig(): RuntimeConfig {
  return React.useContext(RuntimeContext)
}

export function useCapability(name: keyof Capabilities): boolean {
  const config = React.useContext(RuntimeContext)
  return config.capabilities[name] ?? false
}

export function useOfflineMode(): boolean {
  const config = React.useContext(RuntimeContext)
  return config.offline_mode
}

export function useAgentRuntime(): AgentRuntime {
  const config = React.useContext(RuntimeContext)
  return config.agent_runtime ?? defaultRuntimeConfig.agent_runtime!
}
