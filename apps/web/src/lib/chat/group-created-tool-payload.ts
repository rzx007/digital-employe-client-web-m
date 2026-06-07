import { isToolOutputPending } from "./tool-output-pending"

export type GroupCreatedToolPayload = {
  groupId: number
  groupConversationId: number
  groupName?: string
  message?: string
  members?: string
}

export type GroupCreatedBlockKind = "group-created"

function stripJsonFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim()
}

function readId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function parseGroupCreatedToolPayload(
  resultText: string | null | undefined
): GroupCreatedToolPayload | null {
  if (!resultText?.trim()) return null
  try {
    const obj = JSON.parse(stripJsonFence(resultText)) as Record<string, unknown>
    if (!obj || obj.type !== "group_created") return null

    const groupId = readId(obj.group_id)
    const groupConversationId = readId(obj.group_conversation_id)
    if (groupId == null || groupConversationId == null) return null

    return {
      groupId,
      groupConversationId,
      groupName:
        typeof obj.group_name === "string" && obj.group_name.trim()
          ? obj.group_name.trim()
          : undefined,
      message:
        typeof obj.message === "string" && obj.message.trim()
          ? obj.message.trim()
          : undefined,
      members:
        typeof obj.members === "string" && obj.members.trim()
          ? obj.members.trim()
          : undefined,
    }
  } catch {
    return null
  }
}

function isGroupCreatePlainError(resultText: string | null | undefined): boolean {
  const text = resultText?.trim()
  if (!text) return false
  return text.startsWith("错误")
}

export function shouldRenderGroupCreatedBlock(
  state: string,
  resultText: string | null | undefined,
  hasParsedPayload: boolean,
  preliminary?: boolean
): boolean {
  const pending = isToolOutputPending(state, preliminary)
  return (
    hasParsedPayload ||
    pending ||
    state === "output-error" ||
    (!pending && isGroupCreatePlainError(resultText))
  )
}

export function resolveGroupCreatedBlockKind(
  toolName: string,
  state: string,
  resultText: string | null | undefined,
  preliminary?: boolean
): GroupCreatedBlockKind | null {
  if (toolName !== "create_group_and_dispatch") return null
  const payload = parseGroupCreatedToolPayload(resultText)
  if (
    shouldRenderGroupCreatedBlock(
      state,
      resultText,
      payload != null,
      preliminary
    )
  ) {
    return "group-created"
  }
  return null
}
