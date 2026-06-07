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

/**
 * 群澄清卡片是「组长会话中断消息」投影到群时间线的一条消息：行 id 是群消息自己的 id，
 * 但 metadata.clarify_message_id 才等于被 approve 的组长消息 id（approvedId）。乐观封存
 * 必须靠这个字段命中投影卡片，否则群里的 dock（groupActiveHitl 依赖 meta.approved_at）
 * 永远关不掉，用户重复提交后端只能回「该消息已审批」。
 */
function metaClarifyMessageIdMatches(
  meta: Record<string, unknown> | undefined,
  approvedId: string
): boolean {
  if (!meta) return false
  return parseDbMessageId(meta.clarify_message_id) === approvedId
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
  if (metaClarifyMessageIdMatches(meta, approvedId)) return true
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
    if (
      typeof meta.approved_at === "string" &&
      meta.approved_at.length > 0
    ) {
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

function cacheRowMatchesApproved(
  row: Message,
  approvedId: string
): boolean {
  if (String(row.id) === approvedId) return true
  if (getApproveMessageIdFromMeta(row.metadata) === approvedId) return true
  return metaClarifyMessageIdMatches(row.metadata, approvedId)
}

function patchClarifyPartsResolved(
  parts: unknown[] | undefined
): unknown[] | undefined {
  if (!Array.isArray(parts) || parts.length === 0) return parts
  let changed = false
  const next = parts.map((raw) => {
    if (!raw || typeof raw !== "object") return raw
    const part = raw as Record<string, unknown>
    if (part.type !== "tool-submit_clarifying_questions") return raw
    if (part.state === "output-available" || part.state === "output-error") {
      return raw
    }
    changed = true
    return {
      ...part,
      state: "output-available",
      output: part.output ?? { type: "text", value: "用户已提交澄清" },
    }
  })
  return changed ? next : parts
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

/** 群投影卡片：approved_at + 将澄清 tool part 标为已答，防止 refetch 前重复弹 Dock */
export function patchGroupClarifyProjectionResolved(
  queryClient: QueryClient,
  conversationId: string,
  leaderMessageId: string | number,
  approvedAt: string
) {
  patchApprovedAtOnMessagesCache(
    queryClient,
    conversationId,
    leaderMessageId,
    approvedAt
  )
  const key = chatKeys.messages(conversationId)
  const id = parseDbMessageId(leaderMessageId) ?? String(leaderMessageId)
  queryClient.setQueryData<Message[]>(key, (old) => {
    if (!old?.length) return old
    let changed = false
    const next = old.map((row) => {
      if (!cacheRowMatchesApproved(row, id)) return row
      const meta = { ...(row.metadata ?? {}), approved_at: approvedAt }
      const parts = patchClarifyPartsResolved(row.messageParts as unknown[])
      if (
        meta.approved_at === row.metadata?.approved_at &&
        parts === row.messageParts
      ) {
        return row
      }
      changed = true
      return {
        ...row,
        metadata: meta,
        ...(parts !== row.messageParts ? { messageParts: parts } : {}),
      }
    })
    return changed ? next : old
  })
}
