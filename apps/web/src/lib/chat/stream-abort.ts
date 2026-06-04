/** 切换会话 / 卸载页面时主动 abort 的 SSE，不应向用户展示为失败 */
export function isBenignStreamAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false

  const e = error as { name?: string; message?: string; cause?: unknown }
  if (e.name === "AbortError") return true

  const text = `${e.message ?? ""} ${String(e.cause ?? "")}`.toLowerCase()
  return /abort|aborted|signal is aborted|<no response>|no response/i.test(text)
}
