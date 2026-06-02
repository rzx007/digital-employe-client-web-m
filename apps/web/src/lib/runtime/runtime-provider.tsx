import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { getConfigKv } from "@/api/config-kv"
import { fetchRuntimeConfig } from "@/api/system"
import { isElectron, withElectronApi } from "@/lib/electron/host"
import { applyOfflineCapabilities } from "./offline-capabilities"
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

const defaultAgentRuntime: AgentRuntime = {
  serial_mode: false,
  max_concurrent_streams: 0,
  active_streams: 0,
  queued_starts: 0,
  active_items: [],
  queued_items: [],
}

const defaultRuntimeConfig: RuntimeConfig = {
  offline_mode: false,
  llm_label: undefined,
  agent_runtime: defaultAgentRuntime,
  capabilities: defaultCapabilities,
}

export let runtimeCapabilities: Capabilities = defaultCapabilities
export let isOfflineModeFlag = false

const RuntimeContext = React.createContext<RuntimeConfig>(defaultRuntimeConfig)

export function useRuntimeStatusQuery() {
  return useQuery({
    queryKey: ["system", "runtime"],
    queryFn: fetchRuntimeConfig,
    staleTime: 5_000,
    refetchInterval: (query) => {
      const serial = query.state.data?.data?.agent_runtime?.serial_mode
      return serial ? 4_000 : 15_000
    },
  })
}

function usePackageOfflineMode(): boolean {
  const [offline, setOffline] = React.useState(false)

  React.useEffect(() => {
    if (!isElectron()) return
    void withElectronApi(
      async (api) => {
        const status = await api.getBackendStatus()
        setOffline(status.offlinePackage)
      },
      { silent: true }
    )
  }, [])

  return offline
}

function useSerialModeFromKv(apiSerialMode: boolean | undefined): boolean {
  const { data: serialKv } = useQuery({
    queryKey: ["config-kv", "AGENT_SERIAL_MODE"],
    queryFn: () => getConfigKv("AGENT_SERIAL_MODE"),
    staleTime: 10_000,
    enabled: !apiSerialMode,
  })
  return apiSerialMode === true || serialKv?.config_value === "1"
}

export function RuntimeProvider({ children }: { children: React.ReactNode }) {
  const { data } = useRuntimeStatusQuery()
  const packageOffline = usePackageOfflineMode()
  const apiConfig = data?.data
  const apiSerialMode = apiConfig?.agent_runtime?.serial_mode
  const serialMode = useSerialModeFromKv(apiSerialMode)

  const config = React.useMemo((): RuntimeConfig => {
    const base = apiConfig ?? defaultRuntimeConfig
    const offlineMode = base.offline_mode || packageOffline
    const agentRuntime: AgentRuntime = {
      ...(base.agent_runtime ?? defaultAgentRuntime),
      serial_mode: serialMode,
      max_concurrent_streams: serialMode ? 1 : 0,
    }
    return {
      ...base,
      offline_mode: offlineMode,
      capabilities: applyOfflineCapabilities(base.capabilities, offlineMode),
      agent_runtime: agentRuntime,
    }
  }, [apiConfig, packageOffline, serialMode])

  React.useEffect(() => {
    runtimeCapabilities = config.capabilities
    isOfflineModeFlag = config.offline_mode
  }, [config])

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
  return config.agent_runtime ?? defaultAgentRuntime
}
