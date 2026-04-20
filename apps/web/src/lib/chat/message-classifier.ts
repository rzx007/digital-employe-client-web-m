import type { UIMessage } from "ai"

import {
  summarizeToolCall,
  summarizeToolGroup,
  type ToolCallSummary,
} from "./tool-summarizer"

type ToolUIPart = Extract<
  UIMessage["parts"][number],
  { type: `tool-${string}`; toolCallId: string }
>

function isToolUIPart(part: UIMessage["parts"][number]): part is ToolUIPart {
  return part.type.startsWith("tool-") && "toolCallId" in part
}

export interface ToolGroupItem {
  key: string
  toolCallId: string
  toolName: string
  type: string
  state: string
  summary: ToolCallSummary
  resultText: string | null
  part: ToolUIPart
}

export type ClassifiedBlock =
  | { kind: "thinking"; key: string; text: string }
  | { kind: "tool-group"; key: string; tools: ToolGroupItem[]; summary: string }
  | { kind: "final-response"; key: string; text: string }

const THINK_OPEN_RE = /^<think\s*>?\n?/s
const THINK_CLOSE_RE = /\n?\s*<\/think\s*>?\n?/s
const THINK_BLOCK_RE = /<think\s*>?[\s\S]*?<\/think\s*>?\n?/g

function stripThinkTags(text: string): string {
  return text
    .replace(THINK_OPEN_RE, "")
    .replace(THINK_CLOSE_RE, "")
    .trim()
}

function stripThinkSections(text: string): string {
  return text.replace(THINK_BLOCK_RE, "").trim()
}

function extractResultText(part: ToolUIPart): string | null {
  if (!("output" in part) || !part.output || typeof part.output !== "object") {
    return null
  }

  const output = part.output as Record<string, unknown>
  if (typeof output.text === "string" && output.text) {
    return output.text.length > 200
      ? output.text.slice(0, 197) + "..."
      : output.text
  }

  return null
}

export function classifyMessageParts(
  message: UIMessage
): ClassifiedBlock[] {
  const parts = message.parts
  if (parts.length === 0) return []

  const hasAnyTool = parts.some(isToolUIPart)

  if (!hasAnyTool) {
    const text = parts
      .filter((p) => p.type === "text" && "text" in p && p.text)
      .map((p) => ("text" in p ? p.text : ""))
      .join("")

    if (!text) return []

    return [{
      kind: "final-response",
      key: `${message.id}:response:0`,
      text: stripThinkSections(text),
    }]
  }

  const lastToolIndex = parts.reduce(
    (acc, p, i) => (isToolUIPart(p) ? i : acc),
    -1
  )

  const blocks: ClassifiedBlock[] = []
  const toolBuffer: {
    part: ToolUIPart
    index: number
    summary: ToolCallSummary
  }[] = []

  function flushToolBuffer() {
    if (toolBuffer.length === 0) return

    const tools: ToolGroupItem[] = toolBuffer.map((t) => ({
      key: `${message.id}:tool:${t.part.toolCallId}:${t.index}`,
      toolCallId: t.part.toolCallId,
      toolName: t.summary.toolName,
      type: t.part.type,
      state: ("state" in t.part ? (t.part as ToolUIPart).state : "unknown") as string,
      summary: t.summary,
      resultText: extractResultText(t.part),
      part: t.part,
    }))

    blocks.push({
      kind: "tool-group",
      key: `${message.id}:tgroup:${toolBuffer[0].index}`,
      tools,
      summary: summarizeToolGroup(tools.map((t) => t.summary)),
    })

    toolBuffer.length = 0
  }

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]

    if (part.type === "text" && "text" in part && part.text) {
      flushToolBuffer()

      const cleaned = stripThinkTags(part.text)

      if (i > lastToolIndex) {
        const responseText = stripThinkSections(part.text)
        blocks.push({
          kind: "final-response",
          key: `${message.id}:response:${i}`,
          text: responseText,
        })
      } else if (cleaned) {
        blocks.push({
          kind: "thinking",
          key: `${message.id}:thinking:${i}`,
          text: cleaned,
        })
      }

      continue
    }

    if (isToolUIPart(part)) {
      const summary = summarizeToolCall({
        type: part.type,
        input: "input" in part ? (part as ToolUIPart).input : undefined,
      })

      toolBuffer.push({ part, index: i, summary })
      continue
    }

    flushToolBuffer()
  }

  flushToolBuffer()

  return blocks
}
