import { useCallback } from "react"
import { toast } from "sonner"

import {
  createAndSelectCuratorConversation,
  CURATOR_DEFAULT_CONVERSATION_TITLE,
  type CuratorConversationSelectScope,
} from "@/lib/chat/curator-conversation-actions"
import type { Contact } from "@/types/chat"

import { useCreateConversationMutation } from "./use-chat-queries"

export function useCreateCuratorConversation() {
  const createConversationMutation = useCreateConversationMutation()

  const createCuratorConversation = useCallback(
    async (
      contact: Contact,
      title: string = CURATOR_DEFAULT_CONVERSATION_TITLE,
      options?: { selectScope?: CuratorConversationSelectScope }
    ) => {
      try {
        return await createAndSelectCuratorConversation({
          contact,
          title,
          mutateAsync: createConversationMutation.mutateAsync,
          selectScope: options?.selectScope,
        })
      } catch (error) {
        toast.error("创建会话失败", {
          description:
            error instanceof Error ? error.message : "请稍后重试",
        })
        throw error
      }
    },
    [createConversationMutation.mutateAsync]
  )

  return {
    createCuratorConversation,
    isPending: createConversationMutation.isPending,
  }
}
