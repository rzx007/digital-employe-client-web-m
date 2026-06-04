export const MAX_STREAM_RESUME_ATTEMPTS = 3

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

export const STREAM_RESUME_DELAYS_MS = [0, 500, 1500] as const

/** 按 attempt 序号（0-based）调度 resume；返回 timer/raf id 供 cleanup */
export function scheduleStreamResume(
  resumeStream: () => void,
  attemptIndex: number
): ReturnType<typeof setTimeout> | number {
  const delay =
    STREAM_RESUME_DELAYS_MS[
      Math.min(attemptIndex, STREAM_RESUME_DELAYS_MS.length - 1)
    ] ?? 1500
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
