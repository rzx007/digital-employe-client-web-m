import type { UIMessage } from "ai"

export type ToolUIPart = Extract<
  UIMessage["parts"][number],
  { type: `tool-${string}`; toolCallId: string }
>

export function isToolUIPart(part: UIMessage["parts"][number]): part is ToolUIPart {
  return part.type.startsWith("tool-") && "toolCallId" in part
}

export function extractResultText(part: ToolUIPart): string | null {
  if (!("output" in part) || !part.output) {
    return null
  }

  if (typeof part.output === "string") {
    return part.output || null
  }

  if (typeof part.output !== "object") {
    return null
  }

  const output = part.output as Record<string, unknown>
  if (typeof output.text === "string" && output.text) {
    return output.text
  }

  return null
}

export function isPreliminary(part: ToolUIPart): boolean {
  return (
    "preliminary" in part &&
    (part as Record<string, unknown>).preliminary === true
  )
}
