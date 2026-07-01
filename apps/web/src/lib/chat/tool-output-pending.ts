/** 工具 stdout / 结构化 JSON 是否仍在流式输出中 */
export function isToolOutputPending(
  state?: string,
  preliminary?: boolean
): boolean {
  return (
    state === "call" ||
    state === "input-streaming" ||
    state === "input-available" ||
    (state === "output-available" && preliminary === true)
  )
}

export type BatchCountPayload = {
  total: number
  succeeded_count: number
  failed_count: number
}

/** 批量操作计数已齐全且全部失败（避免流式半截 JSON 误判） */
export function isBatchMutationAllFailed(
  payload: BatchCountPayload | null | undefined
): boolean {
  if (!payload || payload.total <= 0) return false
  const done = payload.succeeded_count + payload.failed_count
  if (done < payload.total) return false
  return payload.succeeded_count === 0 && payload.failed_count > 0
}
