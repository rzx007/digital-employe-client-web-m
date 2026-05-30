import { getBackendPort } from "../backend/backend-process"
import { createLogger } from "../../core/logger"

const log = createLogger("activation")

export type StartupGate = "activation" | "login" | "main"

interface ActivationStatus {
  enforced: boolean
  activated: boolean
}

/**
 * 查询后端激活状态。后端是 enforcement 真相源（含本机设备码计算）。
 * 失败时按「未强制」处理，避免误锁；API 仍有 middleware 兜底。
 */
async function fetchActivationStatus(): Promise<ActivationStatus> {
  const port = getBackendPort()
  try {
    const res = await fetch(`http://127.0.0.1:${port}/activation/status`)
    if (!res.ok) return { enforced: false, activated: true }
    const body = (await res.json()) as {
      data?: ActivationStatus
    }
    const data = body.data
    if (!data) return { enforced: false, activated: true }
    return { enforced: !!data.enforced, activated: !!data.activated }
  } catch (err) {
    log.warn("fetch activation status failed", {
      message: err instanceof Error ? err.message : String(err),
    })
    return { enforced: false, activated: true }
  }
}

/**
 * 启动窗口决策（单点）：
 * 1. 强制激活且未激活 -> 激活窗
 * 2. 否则交由调用方按 离线/登录态 决定 main / login
 */
export async function resolveActivationGate(): Promise<StartupGate> {
  const status = await fetchActivationStatus()
  if (status.enforced && !status.activated) return "activation"
  return "main"
}
