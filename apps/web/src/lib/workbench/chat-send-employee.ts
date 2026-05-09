/**
 * POST /workspaces/:id/chat/send 要求 body.employee_id 为整数（见服务端 ChatSendRequest）。
 * 工作台缓存键可使用 "global"，但调用聊天接口时必须传入真实员工 ID。
 */

/** 全局 request 默认 30s；/chat/send 走 agent+LLM 常更久 */
export const WORKBENCH_CHAT_SEND_TIMEOUT_MS = 180_000

export function resolveEmployeeIdForChatSend(
  cacheEmployeeId: string,
  explicitNumericId?: number | null
): number {
  if (
    explicitNumericId != null &&
    Number.isFinite(explicitNumericId) &&
    explicitNumericId > 0
  ) {
    return Math.floor(explicitNumericId)
  }
  const n = Number(cacheEmployeeId)
  if (Number.isFinite(n) && n > 0) {
    return Math.floor(n)
  }
  return 1
}
