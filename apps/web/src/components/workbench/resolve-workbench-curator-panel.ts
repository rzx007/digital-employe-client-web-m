import type { Conversation } from "@/types/chat"

import {
  conversationExistsInList,
  pickFirstConversation,
} from "@/lib/chat/conversation-selection"

export function parseRecentItemConversationId(
  item: { id: string }
): string | null {
  if (item.id.startsWith("recent:")) return null
  if (/^\d+$/.test(item.id)) return item.id
  return null
}

export type WorkbenchCuratorPanelMode = "loading" | "conversation" | "default"

export type WorkbenchCuratorPanelState = {
  mode: WorkbenchCuratorPanelMode
  conversationId?: string | number
}

export function resolveWorkbenchCuratorPanel(input: {
  curatorContactId: string | null
  workbenchCuratorConversationId: string | number | null
  curatorConversations: Conversation[]
  curatorConversationsReady: boolean
  defaultCuratorConversationId: string | number | null
}): WorkbenchCuratorPanelState {
  const {
    curatorContactId,
    workbenchCuratorConversationId,
    curatorConversations,
    curatorConversationsReady,
    defaultCuratorConversationId,
  } = input

  if (!curatorContactId) {
    return { mode: "loading" }
  }

  if (workbenchCuratorConversationId != null) {
    if (!curatorConversationsReady) {
      return {
        mode: "conversation",
        conversationId: workbenchCuratorConversationId,
      }
    }
    if (
      conversationExistsInList(
        curatorConversations,
        workbenchCuratorConversationId
      )
    ) {
      return {
        mode: "conversation",
        conversationId: workbenchCuratorConversationId,
      }
    }
  }

  if (!curatorConversationsReady) {
    return { mode: "loading" }
  }

  const mostRecent = pickFirstConversation(curatorConversations)
  if (mostRecent) {
    return { mode: "conversation", conversationId: mostRecent.id }
  }

  // ensure 接口返回的默认总管会话：列表 refetch 为空时仍可直接进入
  if (defaultCuratorConversationId != null) {
    return {
      mode: "default",
      conversationId: defaultCuratorConversationId,
    }
  }

  return { mode: "loading" }
}
