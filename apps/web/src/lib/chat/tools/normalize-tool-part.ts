import { summarizeToolCall } from "../tool-summarizer"
import { getDisplayContent, getEditDiff, getFilePathFromToolInput, normalizeToolFilePath } from "@/components/chat/message-blocks/tool-shared"
import { extractResultText, isPreliminary, type ToolUIPart } from "./tool-part"
import type { ToolViewModel } from "./tool-view-model"

export function normalizeToolPart(part: ToolUIPart): ToolViewModel {
  const input = "input" in part ? (part as ToolUIPart).input : undefined
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
