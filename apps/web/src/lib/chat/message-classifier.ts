import type { UIMessage } from "ai"

import {
  summarizeToolCall,
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
  input: unknown
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
    // return output.text.length > 200
    //   ? output.text.slice(0, 197) + "..."
    //   : output.text
    return output.text
  }

  return null
}

/**
 * 将 UI 消息的部分（parts）分类为不同的块（blocks），以便在界面上进行结构化展示。
 *
 * 该函数根据消息中是否包含工具调用（Tool Calls）以及文本部分的位置，
 * 将消息内容划分为“最终响应”、“思考过程”或“工具调用组”。
 *
 * @param message - 需要分类的 UI 消息对象，包含唯一标识符和部分内容数组。
 * @returns 分类后的块数组。如果消息为空或无有效内容，则返回空数组。
 */
export function classifyMessageParts(
  message: UIMessage
): ClassifiedBlock[] {
  const parts = message.parts
  if (parts.length === 0) return []

  // 检查消息中是否包含任何工具调用部分
  const hasAnyTool = parts.some(isToolUIPart)

  // 如果没有工具调用，则将所有文本部分合并为一个最终响应块
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

  // 找到最后一个工具调用部分的索引，用于区分工具执行前的思考过程和工具执行后的最终响应
  const lastToolIndex = parts.reduce(
    (acc, p, i) => (isToolUIPart(p) ? i : acc),
    -1
  )

  const blocks: ClassifiedBlock[] = []

  function pushSingleTool(part: ToolUIPart, index: number) {
    const toolInput = "input" in part ? (part as ToolUIPart).input : undefined
    const summary = summarizeToolCall({
      type: part.type,
      input: toolInput,
    })

    const tool: ToolGroupItem = {
      key: `${message.id}:tool:${part.toolCallId}:${index}`,
      toolCallId: part.toolCallId,
      toolName: summary.toolName,
      type: part.type,
      state: ("state" in part ? (part as ToolUIPart).state : "unknown") as string,
      summary,
      resultText: extractResultText(part),
      input: toolInput,
      part,
    }

    blocks.push({
      kind: "tool-group",
      key: `${message.id}:tgroup:${index}`,
      tools: [tool],
      summary: summary.label,
    })
  }

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]

    if (part.type === "text" && "text" in part && part.text) {
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
      pushSingleTool(part, i)
      continue
    }
  }

  return blocks
}
