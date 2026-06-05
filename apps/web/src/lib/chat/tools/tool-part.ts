import type { UIMessage } from "ai"
import { localizeErrorMessage } from "../message-classifier"

export type ToolUIPart = Extract<
  UIMessage["parts"][number],
  { type: `tool-${string}`; toolCallId: string }
>

export function isToolUIPart(part: UIMessage["parts"][number]): part is ToolUIPart {
  return part.type.startsWith("tool-") && "toolCallId" in part
}

/**
 * 工具返回的结构化 JSON（如 {"type":"group_created_and_dispatched",...,"message":"已拉群…"}）
 * 是给模型用的，不该把整坨 JSON 糊给用户看。这里只抽取人类可读的 message 字段。
 * 不是这种 JSON（普通文本/无 message）则原样返回。
 */
function humanizeToolResult(text: string): string {
  const t = text.trim()
  if (!t.startsWith("{") && !t.startsWith("```")) return text
  // 去掉可能的 ```json 围栏后再尝试解析
  const stripped = t.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim()
  try {
    const obj = JSON.parse(stripped)
    if (obj && typeof obj === "object" && typeof obj.message === "string") {
      return obj.message
    }
  } catch {
    // 非合法 JSON，原样返回
  }
  return text
}

export function extractResultText(part: ToolUIPart): string | null {
  if ("output" in part && part.output) {
    if (typeof part.output === "string") {
      return part.output ? humanizeToolResult(part.output) : null
    }

    if (typeof part.output === "object") {
      const output = part.output as Record<string, unknown>
      if (typeof output.text === "string" && output.text) {
        return humanizeToolResult(output.text)
      }
    }
  }

  if ("errorText" in part && typeof part.errorText === "string" && part.errorText) {
    return localizeErrorMessage(part.errorText)
  }

  return null
}

export function isPreliminary(part: ToolUIPart): boolean {
  return (
    "preliminary" in part &&
    (part as Record<string, unknown>).preliminary === true
  )
}
