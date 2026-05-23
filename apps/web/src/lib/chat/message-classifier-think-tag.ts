import type { UIMessage } from "ai"

import { summarizeToolCall, type ToolCallSummary } from "./tool-summarizer"

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
const HAS_THINK_BLOCK_RE = /<think\s*>?[\s\S]*?<\/think\s*>?/s

function stripThinkTags(text: string): string {
  return text.replace(THINK_OPEN_RE, "").replace(THINK_CLOSE_RE, "").trim()
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
    return output.text
  }

  return null
}

/**
 * Think-tag 版本分类器：
 * - 仅包含 <think>...</think> 的 text part 才会产出 thinking block
 * - 去掉 think 片段后的剩余文本一律产出 final-response block
 * - 与文本在工具调用前后的位置无关
 */
export function classifyMessageParts(message: UIMessage): ClassifiedBlock[] {
  const parts = message.parts
  if (parts.length === 0) return []

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
      state: ("state" in part
        ? (part as ToolUIPart).state
        : "unknown") as string,
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
      const rawText = part.text
      const hasThinkBlock = HAS_THINK_BLOCK_RE.test(rawText)

      if (hasThinkBlock) {
        const thinkingText = stripThinkTags(rawText)
        if (thinkingText) {
          blocks.push({
            kind: "thinking",
            key: `${message.id}:thinking:${i}`,
            text: thinkingText,
          })
        }
      }

      const responseText = stripThinkSections(rawText)
      if (responseText) {
        blocks.push({
          kind: "final-response",
          key: `${message.id}:response:${i}`,
          text: responseText,
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
