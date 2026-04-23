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
 * 将 UI 消息的部分内容分类为不同的块（思考过程、工具调用组、最终响应）。
 *
 * 该函数根据消息中是否包含工具调用以及文本部分相对于最后一个工具调用的位置，
 * 将消息拆分为具有特定语义的块。
 *
 * @param message - 需要分类的 UI 消息对象
 * @returns 分类后的块数组，包含思考块、工具组块和最终响应块
 */
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

  /**
   * 将单个工具调用部分转换为工具组块并添加到结果列表中
   *
   @param part - 工具调用部分
   * @param index - 该部分在消息部分数组中的索引
   */
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

  // 遍历所有消息部分，根据类型和位置将其分类为思考、工具组或最终响应
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

/**
 * UIMessage.parts 分类收集逻辑
 *
 * 输入: UIMessage.parts[] (按流式到达顺序排列的 text / tool-* parts)
 *
 * 场景 A — 纯文本对话 (无工具调用):
 * ┌─────────────────────────────────────────────────┐
 * │ parts: [text, text, ...]                        │
 * │   ↓ 合并所有 text, 去除 <think/> 块             │
 * │ output: [final-response]                        │
 * └─────────────────────────────────────────────────┘
 *
 * 场景 B — 含工具调用的对话:
 * ┌─────────────────────────────────────────────────────────────┐
 * │ parts: [text₀, tool₁, tool₂, text₃, tool₄, text₅]         │
 * │          │      │      │      │      │      │               │
 * │          │      │      │      │      │      └─ i>lastTool   │
 * │          │      │      │      │      │         → final-resp │
 * │          │      │      │      │      └─── i==lastTool       │
 * │          │      │      │      │          → tool-group       │
 * │          │      │      │      └──────────→ tool-group       │
 * │          │      │      └─────────────────→ thinking (i≤last)│
 * │          │      └────────────────────────→ tool-group       │
 * │          └───────────────────────────────→ thinking (i≤last)│
 * │                                                              │
 * │ lastToolIndex = 4 (最后一个 tool 的位置)                      │
 * │                                                              │
 * │ 规则:                                                        │
 * │   text part + i ≤ lastToolIndex → thinking (去除 <think/>标签)│
 * │   text part + i > lastToolIndex → final-response (去除块)     │
 * │   tool-* part                   → tool-group (1 tool/block)  │
 * └─────────────────────────────────────────────────────────────┘
 *
 * 输出: ClassifiedBlock[]
 *   | "thinking"     — 工具调用之前的 AI 推理/规划文本
 *   | "tool-group"   — 单个工具调用 (含 input/output/state)
 *   | "final-response" — 所有工具调用完成后的最终回复
 */