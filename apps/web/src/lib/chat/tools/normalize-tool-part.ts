import { summarizeToolCall } from "../tool-summarizer"
import { getDisplayContent, getEditDiff, getFilePathFromToolInput, normalizeToolFilePath } from "@/components/chat/message-blocks/tool-shared"
import { extractResultText, isPreliminary, type ToolUIPart } from "./tool-part"
import type { ToolViewModel } from "./tool-view-model"

/**
 * 工具调用的 input 兜底：被中断 / 流式未拼完的 part，其 input 可能为空 {} 或缺
 * file_path，但原始 args 文本往往还在 part.output.inputText 里（如
 * '{"file_path":"/artifacts/x.md","content":"..."}'）。这里在 input 不含
 * file_path 时，从 inputText 解析回完整 input，避免工具行只剩光秃秃的“创建”。
 */
function recoverInputFromInputText(part: ToolUIPart, input: unknown): unknown {
  const hasFilePath =
    input != null &&
    typeof input === "object" &&
    typeof (input as Record<string, unknown>).file_path === "string"
  if (hasFilePath) return input

  const output = (part as { output?: unknown }).output
  const inputText =
    output != null &&
    typeof output === "object" &&
    typeof (output as Record<string, unknown>).inputText === "string"
      ? ((output as Record<string, unknown>).inputText as string)
      : undefined
  if (!inputText || !inputText.trim()) return input
  try {
    const parsed = JSON.parse(inputText)
    if (parsed != null && typeof parsed === "object") return parsed
  } catch {
    // inputText 可能是流式未闭合的残缺 JSON；尽力用正则抠出 file_path
    const m = inputText.match(/"file_path"\s*:\s*"([^"]+)"/)
    if (m) {
      return { ...(typeof input === "object" && input ? input : {}), file_path: m[1] }
    }
  }
  return input
}

export function normalizeToolPart(part: ToolUIPart): ToolViewModel {
  const rawInput = "input" in part ? (part as ToolUIPart).input : undefined
  const input = recoverInputFromInputText(part, rawInput)
  const state = ("state" in part ? (part as ToolUIPart).state : "unknown") as string
  
  const summary = summarizeToolCall({
    type: part.type,
    input,
  })

  const resultText = extractResultText(part)
  const preliminary = isPreliminary(part)

  const displayContent = getDisplayContent(input, summary.toolName)
  const rawFilePath = getFilePathFromToolInput(input, summary.toolName)
  const normalizedFilePath = rawFilePath ? normalizeToolFilePath(rawFilePath) : null
  const editDiff = summary.toolName === "edit_file" ? getEditDiff(input) : null

  return {
    toolCallId: part.toolCallId,
    toolName: summary.toolName,
    type: part.type,
    state,
    summary,
    resultText,
    input,
    preliminary,
    displayContent,
    normalizedFilePath,
    editDiff,
    part,
  }
}
