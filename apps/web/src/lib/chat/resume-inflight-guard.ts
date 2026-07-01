/**
 * resume 止抖判定：同一会话已有「在飞」的 resume 连接时，跳过新的 resume 触发。
 *
 * 背景：orchestration/群流没有 live POST 流，只能靠 GET /stream/resume 观看；后端
 * resume 一律 `after_seq=None` 全量重放整个 buffer。前端 resume effect 会随 storedMessages
 * 变化反复重跑，每次 `resumeStream()` 都让 transport abort 旧连接 + 重新全量重放 → 画面
 * 「打到一半跳回开头重打」。这里在调度回调真正调用 resumeStream() 之前拦一道：若同会话
 * 已有 resume 连接在飞，直接跳过（连「清空气泡」都不做，不跳屏）。真假死由 transport 的
 * idle 看门狗(SSE_IDLE_TIMEOUT_MS)兜底回收→届时不再在飞→自然放行重连，不会永久卡。
 */
export function shouldSkipResumeWhenInFlight(
  inFlightChatId: string | null,
  requestedChatId: string
): boolean {
  return inFlightChatId !== null && inFlightChatId === requestedChatId
}
