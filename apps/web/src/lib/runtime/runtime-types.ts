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

export interface RuntimeConfig {
  offline_mode: boolean
  capabilities: Capabilities
  activation?: ActivationRuntime
}

export interface RuntimeConfigResponse {
  code: number
  msg: string
  data: RuntimeConfig
}
