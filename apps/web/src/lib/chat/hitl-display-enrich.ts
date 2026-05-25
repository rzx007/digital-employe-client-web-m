import type { UIMessage } from "ai"

import {
  CLARIFY_TOOL_NAME,
  DOCUMENT_PLAN_TOOL_NAME,
} from "./hitl-tool-call-resolve"
import { toolPartHasFinalOutput } from "./hitl-abort-message-utils"

const HITL_TOOL_TYPES = new Set([
  `tool-${CLARIFY_TOOL_NAME}`,
  `tool-${DOCUMENT_PLAN_TOOL_NAME}`,
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object"
}

function hasValidHitlInput(input: unknown): boolean {
  if (!isRecord(input)) return false
  if (Object.keys(input).length === 0) return false
  return true
}

function isPendingHitlSourcePart(part: UIMessage["parts"][number]): boolean {
  if (!HITL_TOOL_TYPES.has(part.type)) return false
  if ((part as { state?: string }).state !== "input-available") return false
  const input = "input" in part ? (part as { input: unknown }).input : undefined
  return hasValidHitlInput(input)
}

function isResolvedHitlTargetPart(part: UIMessage["parts"][number]): boolean {
  if (!HITL_TOOL_TYPES.has(part.type)) return false
  if (toolPartHasFinalOutput(part as { state?: string; output?: unknown })) {
    return true
  }
  const output = "output" in part ? (part as { output?: unknown }).output : undefined
  if (isRecord(output) && typeof output.text === "string" && output.text.trim()) {
    return true
  }
  return false
}

function needsInputEnrichment(part: UIMessage["parts"][number]): boolean {
  const input = "input" in part ? (part as { input: unknown }).input : undefined
  return !hasValidHitlInput(input)
}

/** 展示层：将同泡内 sealed pending 的 input 回填到 output-available part */
export function enrichHitlResolvedPartsInMessage(
  message: UIMessage
): UIMessage {
  if (message.role !== "assistant" || message.parts.length === 0) {
    return message
  }

  const inputByToolCallId = new Map<string, unknown>()
  const inputByToolType = new Map<string, unknown>()

  for (const part of message.parts) {
    if (!isPendingHitlSourcePart(part)) continue
    const input = (part as { input: unknown }).input
    const toolCallId =
      "toolCallId" in part && typeof part.toolCallId === "string"
        ? part.toolCallId
        : ""
    if (toolCallId) {
      inputByToolCallId.set(toolCallId, input)
    }
    if (!inputByToolType.has(part.type)) {
      inputByToolType.set(part.type, input)
    }
  }

  if (inputByToolCallId.size === 0 && inputByToolType.size === 0) {
    return message
  }

  let changed = false
  const parts = message.parts.map((part) => {
    if (!isResolvedHitlTargetPart(part) || !needsInputEnrichment(part)) {
      return part
    }

    const toolCallId =
      "toolCallId" in part && typeof part.toolCallId === "string"
        ? part.toolCallId
        : ""
    const sourceInput =
      (toolCallId ? inputByToolCallId.get(toolCallId) : undefined) ??
      inputByToolType.get(part.type)

    if (!hasValidHitlInput(sourceInput)) return part

    changed = true
    const clonedInput = isRecord(sourceInput)
      ? { ...sourceInput }
      : sourceInput
    const output =
      "output" in part && isRecord(part.output)
        ? { ...part.output, input: clonedInput }
        : part

    return {
      ...part,
      input: clonedInput,
      output,
    } as UIMessage["parts"][number]
  })

  return changed ? { ...message, parts } : message
}
