// 「连续」未接上的 resume 上限——不是整个 turn 的永久配额。每次断流若发生在流仍
// streaming 时（接上后又断）会重置计数（见 use-conversation-session R-1），故长任务的
// 反复断开不会耗尽它；这里的上限只用来拦「服务端真死、怎么都连不上」的热循环。
// 配合 after_seq 增量续流（幂等、不重复），把它放宽到 8 次，对应退避最长 ~10s 一轮。
export const MAX_STREAM_RESUME_ATTEMPTS = 8

export type ResumeDecisionInput = {
  hitlActive: boolean
  lastAssistantStreamState: string | undefined
  lastAssistantId: string | undefined
  resumeAttempts: Record<string, number>
  maxAttempts?: number
}

export function shouldAttemptResume(input: ResumeDecisionInput): boolean {
  if (input.hitlActive) return false
  if (input.lastAssistantStreamState !== "streaming") return false
  if (!input.lastAssistantId) return false
  const max = input.maxAttempts ?? MAX_STREAM_RESUME_ATTEMPTS
  const attempts = input.resumeAttempts[input.lastAssistantId] ?? 0
  if (attempts >= max) return false
  return true
}

// 退避阶梯（opencode 式：首跳近即时，随后指数退避并封顶）。前几跳快（断流多为
// 中间层瞬断，立刻续上即可），连不上才逐步拉长到 ~10s 一轮，避免热循环打爆后端。
export const STREAM_RESUME_DELAYS_MS = [
  0, 250, 750, 1500, 3000, 5000, 8000, 10000,
] as const

/** 按 attempt 序号（0-based）调度 resume；返回 timer/raf id 供 cleanup */
export function scheduleStreamResume(
  resumeStream: () => void,
  attemptIndex: number
): ReturnType<typeof setTimeout> | number {
  const delay =
    STREAM_RESUME_DELAYS_MS[
      Math.min(attemptIndex, STREAM_RESUME_DELAYS_MS.length - 1)
    ] ?? 10000
  if (delay === 0) {
    return requestAnimationFrame(() => resumeStream())
  }
  return setTimeout(resumeStream, delay)
}

export function cancelScheduledStreamResume(
  handle: ReturnType<typeof setTimeout> | number | null
) {
  if (handle == null) return
  if (typeof handle === "number") {
    cancelAnimationFrame(handle)
  } else {
    clearTimeout(handle)
  }
}
