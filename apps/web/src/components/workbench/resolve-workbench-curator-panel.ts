import type { Conversation } from "@/types/chat"

import {
  conversationExistsInList,
  pickFirstConversation,
} from "@/lib/chat/conversation-selection"

export type WorkbenchCuratorPanelMode = "loading" | "conversation" | "default"

export type WorkbenchCuratorPanelState = {
  mode: WorkbenchCuratorPanelMode
  conversationId?: string | number
}

export function resolveWorkbenchCuratorPanel(input: {
  curatorContactId: string | null
  selectedConversationId: string | number | null
  curatorConversations: Conversation[]
  curatorConversationsReady: boolean
  defaultCuratorConversationId: string | number | null
}): WorkbenchCuratorPanelState {
  const {
    curatorContactId,
    selectedConversationId,
    curatorConversations,
    curatorConversationsReady,
    defaultCuratorConversationId,
  } = input

  if (!curatorContactId) {
    return { mode: "loading" }
  }

  if (
    selectedConversationId != null &&
    conversationExistsInList(curatorConversations, selectedConversationId)
  ) {
    return {
      mode: "conversation",
      conversationId: selectedConversationId,
    }
  }

  if (
    defaultCuratorConversationId != null &&
    conversationExistsInList(
      curatorConversations,
      defaultCuratorConversationId
    )
  ) {
    return {
      mode: "default",
      conversationId: defaultCuratorConversationId,
    }
  }

  const first = pickFirstConversation(curatorConversations)
  if (first) {
    return { mode: "default", conversationId: first.id }
  }

  if (!curatorConversationsReady && defaultCuratorConversationId != null) {
    return {
      mode: "default",
      conversationId: defaultCuratorConversationId,
    }
  }

  return { mode: "loading" }
}
