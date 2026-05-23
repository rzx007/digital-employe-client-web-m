import type { QueryClient } from "@tanstack/react-query"

import type { Message } from "@/lib/mock-data/messages"
import { chatKeys } from "@/lib/query-keys/chat"

function findLastAssistantIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") return i
  }
  return -1
}

export function getLastAssistantMessage(
  messages: Message[]
): Message | undefined {
  const idx = findLastAssistantIndex(messages)
  return idx >= 0 ? messages[idx] : undefined
}

export function patchLastAssistantStreamState(
  queryClient: QueryClient,
  conversationId: string | number,
  streamState: string,
  patch?: Partial<Pick<Message, "content">>
) {
  const key = chatKeys.messages(String(conversationId))
  queryClient.setQueryData<Message[]>(key, (old) => {
    if (!old?.length) return old
    const idx = findLastAssistantIndex(old)
    if (idx < 0) return old
    const next = [...old]
    next[idx] = {
      ...next[idx],
      streamState,
      ...patch,
    }
    return next
  })
}
