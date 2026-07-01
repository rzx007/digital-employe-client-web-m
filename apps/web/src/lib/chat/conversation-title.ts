import { suggestConversationTitle as suggestConversationTitleApi } from "@/api/chat"

export const DEFAULT_CONVERSATION_TITLE = "新对话"

const PLACEHOLDER_CONVERSATION_TITLES = new Set([
  DEFAULT_CONVERSATION_TITLE,
  "总管对话",
])

const SUGGEST_TITLE_TIMEOUT_MS = 3000

export function shouldRenameConversationOnFirstMessage(
  title: string | undefined
): boolean {
  const t = title?.trim()
  return !t || PLACEHOLDER_CONVERSATION_TITLES.has(t)
}

export function fallbackConversationTitle(message: string): string {
  const text = message.trim()
  if (!text) return DEFAULT_CONVERSATION_TITLE
  return text.slice(0, 50)
}

export async function resolveConversationTitle(message: string): Promise<string> {
  const controller = new AbortController()
  const timeout = window.setTimeout(
    () => controller.abort(),
    SUGGEST_TITLE_TIMEOUT_MS
  )
  try {
    const res = await suggestConversationTitleApi(message, {
      signal: controller.signal,
    })
    const title = res?.data?.title?.trim()
    if (title) return title
  } catch {
    // API 失败或超时时使用本地 fallback
  } finally {
    window.clearTimeout(timeout)
  }
  return fallbackConversationTitle(message)
}

export async function applySemanticConversationTitle(options: {
  conversationId: string | number
  messageText: string
  contactId: string
  updateTitle: (params: {
    conversationId: string | number
    title: string
    contactId: string
  }) => Promise<unknown>
  onError?: () => void
}): Promise<void> {
  try {
    const title = await resolveConversationTitle(options.messageText)
    await options.updateTitle({
      conversationId: options.conversationId,
      title,
      contactId: options.contactId,
    })
  } catch {
    options.onError?.()
  }
}
