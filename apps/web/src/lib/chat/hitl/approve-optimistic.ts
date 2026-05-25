import type { QueryClient } from "@tanstack/react-query"
import type { UIMessage } from "ai"

import type { Message } from "@/types/chat"
import { chatKeys } from "@/lib/query-keys/chat"

export function createApprovedAtTimestamp(): string {
  return new Date().toISOString()
}

/** POST /approve 成功后立刻封存 composer 行，使 findPendingHitl 跳过 */
export function patchApprovedAtOnComposerMessages(
  prev: UIMessage[],
  messageId: string | number,
  approvedAt: string
): UIMessage[] {
  const id = String(messageId)
  let changed = false
  const next = prev.map((m) => {
    if (m.role !== "assistant" || String(m.id) !== id) return m
    const meta =
      (m as UIMessage & { metadata?: Record<string, unknown> }).metadata ?? {}
    if (
      typeof meta.approved_at === "string" &&
      meta.approved_at.length > 0
    ) {
      return m
    }
    changed = true
    return {
      ...m,
      metadata: { ...meta, approved_at: approvedAt },
    } as UIMessage
  })
  return changed ? next : prev
}

/** 与 composer 同步，refetch 前 initialMessages 也能带上 approved_at */
export function patchApprovedAtOnMessagesCache(
  queryClient: QueryClient,
  conversationId: string,
  messageId: string | number,
  approvedAt: string
) {
  const key = chatKeys.messages(conversationId)
  queryClient.setQueryData<Message[]>(key, (old) => {
    if (!old?.length) return old
    const id = String(messageId)
    const idx = old.findIndex((m) => String(m.id) === id)
    if (idx < 0) return old
    const row = old[idx]
    const meta = { ...(row.metadata ?? {}), approved_at: approvedAt }
    if (meta.approved_at === row.metadata?.approved_at) return old
    const next = [...old]
    next[idx] = { ...row, metadata: meta }
    return next
  })
}
