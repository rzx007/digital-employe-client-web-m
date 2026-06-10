/**
 * 客户端活跃度埋点（用户活跃度 + 技能活跃度）
 *
 * 设计：内存队列 + localStorage 落盘（离线/退出兜底）+ 攒批上报。
 * - fire-and-forget，任何异常都吞掉，绝不阻塞 UI。
 * - 未登录（无 token）时只入队不上报，登录后由 flush 统一补发。
 * - user_id / tenant_id 由服务端从 token 解析，前端不传，避免伪造。
 */
import { getAuthToken, request } from "@/lib/request"
import { isOfflineModeFlag } from "@/lib/runtime/runtime-provider"

export type ActivityEventType =
  | "login"
  | "app_open"
  | "skill_view"
  | "skill_install"
  | "skill_uninstall"
  | "skill_edit"
  | "skill_invoke"

interface SkillRef {
  skillId?: number
  skillName?: string | null
}

interface QueuedEvent {
  event_type: ActivityEventType
  occurred_at: string
  skill_id?: number
  skill_name?: string
  workspace_id?: string
  client_ver?: string
  platform?: string
  extra?: Record<string, unknown>
}

const ENDPOINT = "/digital/api/v1/analytics/events"
const STORAGE_KEY = "telemetry_queue"
const FLUSH_INTERVAL_MS = 30_000
const BATCH_SIZE = 20
const MAX_QUEUE = 500

let queue: QueuedEvent[] = []
let flushing = false
let started = false

function isBrowser(): boolean {
  return typeof window !== "undefined"
}

function detectPlatform(): string | undefined {
  if (typeof navigator === "undefined") return undefined
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes("win")) return "win"
  if (ua.includes("mac")) return "mac"
  if (ua.includes("linux")) return "linux"
  return undefined
}

function clientVersion(): string | undefined {
  return import.meta.env.VITE_APP_VERSION || undefined
}

function persist(): void {
  if (!isBrowser()) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue))
  } catch {
    // 配额满等情况忽略
  }
}

function loadFromStorage(): void {
  if (!isBrowser()) return
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) queue = parsed.slice(-MAX_QUEUE)
    }
  } catch {
    queue = []
  }
}

/** 上报一条事件（入队，必要时触发 flush） */
export function track(
  eventType: ActivityEventType,
  opts: { skill?: SkillRef; extra?: Record<string, unknown> } = {}
): void {
  if (!isBrowser()) return
  if (isOfflineModeFlag) return // 离线模式不上报活跃度
  try {
    // 显示名（真实姓名）随事件带上（token 里没有，只有客户端有）
    const displayName = localStorage.getItem("displayName") || undefined
    const mergedExtra = {
      ...(opts.extra || {}),
      ...(displayName ? { name: displayName } : {}),
    }
    const ev: QueuedEvent = {
      event_type: eventType,
      occurred_at: new Date().toISOString(),
      workspace_id: localStorage.getItem("workspaceId") || undefined,
      client_ver: clientVersion(),
      platform: detectPlatform(),
      extra: Object.keys(mergedExtra).length ? mergedExtra : undefined,
    }
    if (opts.skill) {
      if (opts.skill.skillId != null) ev.skill_id = opts.skill.skillId
      if (opts.skill.skillName) ev.skill_name = opts.skill.skillName
    }

    queue.push(ev)
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE)
    persist()

    if (queue.length >= BATCH_SIZE) void flush()
  } catch {
    // 埋点绝不影响主流程
  }
}

/** 技能类事件便捷封装 */
export function trackSkill(
  eventType: Extract<ActivityEventType, `skill_${string}`>,
  skill: SkillRef,
  extra?: Record<string, unknown>
): void {
  track(eventType, { skill, extra })
}

// 技能调用去重：同一去重键只上报一次（避免同一技能在一次回复内多次工具调用重复计数）
const seenSkillInvokes = new Set<string>()

/**
 * 上报「技能被调用」——以技能名为准（本地技能无服务端 id）。
 * dedupeKey 通常用 `${messageId}:${skillName}`，保证一次回复内每个技能只计一次。
 */
export function reportSkillInvokeOnce(skillName: string, dedupeKey: string): void {
  const name = (skillName || "").trim()
  if (!name || seenSkillInvokes.has(dedupeKey)) return
  seenSkillInvokes.add(dedupeKey)
  track("skill_invoke", { skill: { skillName: name } })
}

/** 将队列攒批上报；未登录或为空时跳过 */
export async function flush(): Promise<void> {
  if (!isBrowser() || flushing) return
  if (queue.length === 0) return
  if (isOfflineModeFlag) return // 离线模式不上报活跃度
  if (!getAuthToken()) return // 未登录，留待登录后补发

  flushing = true
  const batch = queue.slice(0, BATCH_SIZE)
  try {
    await request(ENDPOINT, {
      method: "POST",
      body: { events: batch },
      retry: 0,
    })
    // 成功后移除已发送的部分
    queue = queue.slice(batch.length)
    persist()
  } catch {
    // 失败保留队列，下次重试
  } finally {
    flushing = false
  }
  // 队列仍有积压则继续（登录后一次性补发场景）
  if (queue.length > 0 && getAuthToken()) {
    setTimeout(() => void flush(), 500)
  }
}

/** 初始化定时器与生命周期监听，仅执行一次 */
export function initTelemetry(): void {
  if (started || !isBrowser()) return
  started = true
  loadFromStorage()

  setInterval(() => void flush(), FLUSH_INTERVAL_MS)

  // 切到后台 / 关闭前尽量落盘并补发一次
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      persist()
      void flush()
    }
  })
  window.addEventListener("beforeunload", () => {
    persist()
  })

  // 启动即尝试补发上次残留
  void flush()
}
