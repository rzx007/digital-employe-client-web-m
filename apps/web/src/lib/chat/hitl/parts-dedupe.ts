import type { UIMessage } from "ai"

import { HITL_TOOL_TYPES } from "./constants"
import {
  getResolvedHitlToolCallIds,
  toolPartHasFinalOutput,
} from "./part-utils"

/**
 * 后端 interrupt 时写入的占位正文（stream_registry.py: final_text = "等待用户确认..."）。
 * resume 后这条 interrupted 消息与 completed 消息合并到同一气泡，占位正文会成为孤儿。
 * 当本气泡内 HITL 已 resolved 时，精确匹配并过滤掉它（仅此占位，不误删正常正文）。
 */
const HITL_PENDING_PLACEHOLDER_TEXTS = new Set(["等待用户确认...", "等待用户确认…"])

function isResolvedHitlPlaceholderTextPart(
  part: UIMessage["parts"][number]
): boolean {
  if (part.type !== "text" || !("text" in part) || typeof part.text !== "string") {
    return false
  }
  return HITL_PENDING_PLACEHOLDER_TEXTS.has(part.text.trim())
}

/** 同一条 assistant 消息内，已有 output 的 toolCallId 对应的 pending part 视为陈旧副本 */
function isStalePendingHitlPart(
  part: UIMessage["parts"][number],
  resolvedToolCallIds: Set<string>
): boolean {
  if (!HITL_TOOL_TYPES.has(part.type)) return false

  const toolPart = part as { state?: string; output?: unknown }
  if (toolPartHasFinalOutput(toolPart)) return false

  const state = toolPart.state
  if (state === "output-available" || state === "output-error") return false

  const isPendingState =
    state === undefined ||
    state === "input-available" ||
    state === "input-streaming" ||
    state === "call"
  if (!isPendingState) return false

  const toolCallId =
    "toolCallId" in part && typeof part.toolCallId === "string"
      ? part.toolCallId
      : ""
  return Boolean(toolCallId && resolvedToolCallIds.has(toolCallId))
}

function isDuplicatePendingHitlPart(
  part: UIMessage["parts"][number]
): boolean {
  if (!HITL_TOOL_TYPES.has(part.type)) return false
  const toolPart = part as { state?: string; output?: unknown }
  if (toolPartHasFinalOutput(toolPart)) return false
  const state = toolPart.state
  return (
    state === undefined ||
    state === "input-available" ||
    state === "input-streaming" ||
    state === "call"
  )
}

/** 同 toolCallId 多个 pending HITL part 时只保留最后一段（流式 + interrupt 重复注入） */
function dedupeDuplicatePendingHitlParts(
  parts: UIMessage["parts"]
): UIMessage["parts"] {
  const pendingIndicesById = new Map<string, number[]>()
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!isDuplicatePendingHitlPart(part)) continue
    const toolCallId =
      "toolCallId" in part && typeof part.toolCallId === "string"
        ? part.toolCallId
        : ""
    if (!toolCallId) continue
    const list = pendingIndicesById.get(toolCallId) ?? []
    list.push(i)
    pendingIndicesById.set(toolCallId, list)
  }

  const drop = new Set<number>()
  for (const indices of pendingIndicesById.values()) {
    if (indices.length <= 1) continue
    for (let j = 0; j < indices.length - 1; j++) {
      drop.add(indices[j])
    }
  }
  if (drop.size === 0) return parts
  return parts.filter((_, i) => !drop.has(i))
}

function toolPartToolCallId(part: UIMessage["parts"][number]): string {
  if (typeof part.type !== "string" || !part.type.startsWith("tool-")) return ""
  return "toolCallId" in part && typeof part.toolCallId === "string"
    ? part.toolCallId
    : ""
}

/**
 * 防御层：同一 toolCallId 的工具块只保留一份（优先有最终 output 的，否则最后一个）。
 * 不依赖 HITL 类型与 pending/resolved 对齐，兜住 resume 重放在 msg_A/msg_B 间产生的
 * 残余重复（主修在源头：langchain-stream-parser 的 sealedToolCallIds）。
 */
function dedupeToolPartsByToolCallId(
  parts: UIMessage["parts"]
): UIMessage["parts"] {
  const indicesById = new Map<string, number[]>()
  for (let i = 0; i < parts.length; i++) {
    const id = toolPartToolCallId(parts[i])
    if (!id) continue
    const list = indicesById.get(id) ?? []
    list.push(i)
    indicesById.set(id, list)
  }

  const drop = new Set<number>()
  for (const indices of indicesById.values()) {
    if (indices.length <= 1) continue
    let keep = indices[indices.length - 1]
    for (const idx of indices) {
      if (
        toolPartHasFinalOutput(parts[idx] as { state?: string; output?: unknown })
      ) {
        keep = idx
      }
    }
    for (const idx of indices) {
      if (idx !== keep) drop.add(idx)
    }
  }

  if (drop.size === 0) return parts
  return parts.filter((_, i) => !drop.has(i))
}

function normalizeTextForDedupe(text: string): string {
  return text.trim().replace(/\s+/g, " ")
}

/** 同一条消息内重复 text part（常见于 merge 连续 assistant 或流式+flush 叠加） */
function dedupeDuplicateTextParts(
  parts: UIMessage["parts"]
): UIMessage["parts"] {
  const textIndicesByNorm = new Map<string, number[]>()
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part.type !== "text" || !("text" in part) || typeof part.text !== "string") {
      continue
    }
    const norm = normalizeTextForDedupe(part.text)
    if (!norm) continue
    const list = textIndicesByNorm.get(norm) ?? []
    list.push(i)
    textIndicesByNorm.set(norm, list)
  }

  const drop = new Set<number>()
  for (const indices of textIndicesByNorm.values()) {
    if (indices.length <= 1) continue
    for (let j = 0; j < indices.length - 1; j++) {
      drop.add(indices[j])
    }
  }
  if (drop.size === 0) return parts
  return parts.filter((_, i) => !drop.has(i))
}

/** HITL tool + 重复 text 归一（展示管道用） */
export function normalizeAssistantMessageParts(
  parts: UIMessage["parts"]
): UIMessage["parts"] {
  const resolvedToolCallIds = getResolvedHitlToolCallIds(parts)
  const withoutStale =
    resolvedToolCallIds.size === 0
      ? parts
      : parts.filter(
          (part) =>
            !isStalePendingHitlPart(part, resolvedToolCallIds) &&
            !isResolvedHitlPlaceholderTextPart(part)
        )
  return dedupeToolPartsByToolCallId(
    dedupeDuplicateTextParts(dedupeDuplicatePendingHitlParts(withoutStale))
  )
}

export function dedupeHitlPartsInMessage(message: UIMessage): UIMessage {
  if (message.role !== "assistant") return message
  const parts = normalizeAssistantMessageParts(message.parts)
  if (parts === message.parts) {
    return message
  }
  return { ...message, parts }
}

export function dedupeHitlPartsInMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map(dedupeHitlPartsInMessage)
}
