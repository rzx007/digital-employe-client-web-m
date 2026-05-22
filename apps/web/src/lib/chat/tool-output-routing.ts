/** 将 tool_output SSE 事件路由到正确的 toolCallId（多同名工具时避免命中第一个）。 */

export interface ToolOutputRoutingContext {
  toolNamesById: Map<string, string>
  activeToolCallId: string | null
}

function getStringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null
}

function findLastToolCallIdByToolName(
  toolNamesById: Map<string, string>,
  toolName: string
): string | null {
  let last: string | null = null
  for (const [callId, name] of toolNamesById) {
    if (name === toolName) {
      last = callId
    }
  }
  return last
}

export function resolveToolCallIdForToolOutput(
  ctx: ToolOutputRoutingContext,
  toolName: string,
  toolCallIdFromEvent?: unknown
): string | null {
  const fromEvent = getStringValue(toolCallIdFromEvent)
  if (fromEvent) {
    return fromEvent
  }

  if (
    ctx.activeToolCallId &&
    ctx.toolNamesById.get(ctx.activeToolCallId) === toolName
  ) {
    return ctx.activeToolCallId
  }

  return findLastToolCallIdByToolName(ctx.toolNamesById, toolName)
}
