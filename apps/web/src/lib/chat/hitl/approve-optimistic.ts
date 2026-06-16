import type { QueryClient } from "@tanstack/react-query"
import type { UIMessage } from "ai"

import type { Message } from "@/types/chat"
import { chatKeys } from "@/lib/query-keys/chat"

import {
  getApproveMessageIdFromMeta,
  HITL_APPROVE_MESSAGE_ID_META_KEY,
  parseDbMessageId,
  assistantMessageHasToolCallId,
} from "./message-id"

export function createApprovedAtTimestamp(): string {
  return new Date().toISOString()
}

function assistantMatchesApproved(
  m: UIMessage,
  approvedId: string,
  toolCallId?: string
): boolean {
  if (m.role !== "assistant") return false
  if (String(m.id) === approvedId) return true
  const meta = (m as UIMessage & { metadata?: Record<string, unknown> })
    .metadata
  if (getApproveMessageIdFromMeta(meta) === approvedId) return true
  if (toolCallId && assistantMessageHasToolCallId(m, toolCallId)) return true
  return false
}

/** POST /approve 成功后立刻封存 composer 行，使 findPendingHitl 跳过 */
export function patchApprovedAtOnComposerMessages(
  prev: UIMessage[],
  messageId: string | number,
  approvedAt: string,
  toolCallId?: string
): UIMessage[] {
  const id = parseDbMessageId(messageId) ?? String(messageId)
  let changed = false
  const next = prev.map((m) => {
    if (!assistantMatchesApproved(m, id, toolCallId)) return m
    const meta =
      (m as UIMessage & { metadata?: Record<string, unknown> }).metadata ?? {}
    if (typeof meta.approved_at === "string" && meta.approved_at.length > 0) {
      return m
    }
    changed = true
    const nextMeta: Record<string, unknown> = {
      ...meta,
      approved_at: approvedAt,
    }
    if (parseDbMessageId(id) && !getApproveMessageIdFromMeta(meta)) {
      nextMeta[HITL_APPROVE_MESSAGE_ID_META_KEY] = id
    }
    return {
      ...m,
      metadata: nextMeta,
    } as UIMessage
  })
  return changed ? next : prev
}

function cacheRowMatchesApproved(row: Message, approvedId: string): boolean {
  if (String(row.id) === approvedId) return true
  return getApproveMessageIdFromMeta(row.metadata) === approvedId
}

/** 与 composer 同步，refetch 前 initialMessages 也能带上 approved_at */
export function patchApprovedAtOnMessagesCache(
  queryClient: QueryClient,
  conversationId: string,
  messageId: string | number,
  approvedAt: string
) {
  const key = chatKeys.messages(conversationId)
  const id = parseDbMessageId(messageId) ?? String(messageId)
  queryClient.setQueryData<Message[]>(key, (old) => {
    if (!old?.length) return old
    let changed = false
    const next = old.map((row) => {
      if (!cacheRowMatchesApproved(row, id)) return row
      const meta = { ...(row.metadata ?? {}), approved_at: approvedAt }
      if (parseDbMessageId(id) && !getApproveMessageIdFromMeta(row.metadata)) {
        meta[HITL_APPROVE_MESSAGE_ID_META_KEY] = id
      }
      if (meta.approved_at === row.metadata?.approved_at) return row
      changed = true
      return { ...row, metadata: meta }
    })
    return changed ? next : old
  })
}
