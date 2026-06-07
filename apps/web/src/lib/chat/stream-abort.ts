/** 切换会话 / 卸载页面时主动 abort 的 SSE，不应向用户展示为失败 */
export function isBenignStreamAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false

  const e = error as { name?: string; message?: string; cause?: unknown }
  if (e.name === "AbortError") return true

  const text = `${e.message ?? ""} ${String(e.cause ?? "")}`.toLowerCase()
  return /abort|aborted|signal is aborted|<no response>|no response/i.test(text)
}

/**
 * SSE 连接在收到任何权威终止信号（[DONE] / interrupted / stream_ended /
 * no_stream / error）之前就被对端关闭（reader done=true）。这不是流正常结束，
 * 而是「连接中途断开、turn 可能仍在跑」——上层应据此自动 resume 续流，
 * 而非当作 finish 收尾（否则执行会话会「假结束、看不出在干活」）。
 */
export const STREAM_DISCONNECTED_ERROR_NAME = "StreamDisconnectedError"

export class StreamDisconnectedError extends Error {
  constructor(message = "SSE 流在收到终止信号前断开") {
    super(message)
    this.name = STREAM_DISCONNECTED_ERROR_NAME
  }
}

/** 是否为「流未正常终止即断开」错误：上层据此触发 resume 续流。 */
export function isStreamDisconnectedError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { name?: string }).name === STREAM_DISCONNECTED_ERROR_NAME
  )
}
