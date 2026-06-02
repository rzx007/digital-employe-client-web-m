export interface Capabilities {
  remote_login: boolean
  remote_model_sync: boolean
  remote_skills: boolean
  remote_mcp: boolean
  remote_performance: boolean
  dispatch_order_sync: boolean
  oauth: boolean
  feishu_platform: boolean
  skill_rating_upload: boolean
  mcp_task_execution: boolean
  activation_enforced: boolean
}

export interface ActivationRuntime {
  enforced: boolean
  activated: boolean
  expires_at: string | null
  days_remaining: number | null
  reason: string | null
}

export interface AgentRuntimeItem {
  conversation_id: number
  title: string
  source: string
  priority?: number
}

export interface StreamMetricsInflight {
  conversation_id: number
  source: string
  started_at: number
  elapsed_ms: number
  ttft_ms: number | null
  tokens: number
}

export interface StreamMetricsRecent {
  conversation_id: number
  source: string
  started_at: number
  ttft_ms: number | null
  total_ms: number | null
  tokens: number
  tps: number | null
  status: string | null
  error: string | null
}

export interface StreamMetricsPercentiles {
  p50: number | null
  p95: number | null
  max: number | null
}

export interface StreamMetricsSummary {
  count: number
  non_completed?: number
  ttft_ms?: StreamMetricsPercentiles
  total_ms?: StreamMetricsPercentiles
  tps_avg?: number | null
}

export interface StreamMetrics {
  inflight: StreamMetricsInflight[]
  recent: StreamMetricsRecent[]
  summary: StreamMetricsSummary
}

export interface AgentRuntime {
  serial_mode: boolean
  max_concurrent_streams: number
  active_streams: number
  queued_starts: number
  active_items?: AgentRuntimeItem[]
  queued_items?: AgentRuntimeItem[]
  metrics?: StreamMetrics
}

export interface RuntimeConfig {
  offline_mode: boolean
  llm_label?: string
  capabilities: Capabilities
  agent_runtime?: AgentRuntime
  activation?: ActivationRuntime
}

export interface RuntimeConfigResponse {
  code: number
  msg: string
  data: RuntimeConfig
}
