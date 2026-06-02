import type { Capabilities } from "./runtime-types"

/** 与后端 runtime_capabilities.py 离线分支保持一致 */
export function applyOfflineCapabilities(
  caps: Capabilities,
  offline: boolean
): Capabilities {
  if (!offline) return caps
  return {
    ...caps,
    remote_login: false,
    remote_mcp: false,
    remote_performance: false,
    dispatch_order_sync: false,
    oauth: false,
    feishu_platform: false,
    skill_rating_upload: false,
    mcp_task_execution: false,
    remote_model_sync: true,
    remote_skills: true,
  }
}
