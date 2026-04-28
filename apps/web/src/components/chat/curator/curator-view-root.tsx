import * as React from "react"
import type { Conversation } from "@/lib/mock-data/conversations"
import { CURATOR_PINNED_CONVERSATION_ID } from "@/lib/constants"
import type { ChatViewContact } from "../chat-view-shared"
import { CuratorMonitorView } from "./curator-monitor-view"
import { CuratorDraftView } from "./curator-draft-view"
import { CuratorConversationView } from "./curator-conversation-view"

export function CuratorView({
  contact,
  conversations,
  selectedConversation,
  selectedConversationId,
  isDraftConversation,
  onOpenContacts,
  onOpenConversations,
  onNewConversation,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  contact?: ChatViewContact
  conversations: Conversation[]
  selectedConversation?: Conversation | undefined
  selectedConversationId: string | number | null
  isDraftConversation: boolean
  onOpenContacts?: () => void
  onOpenConversations?: () => void
  onNewConversation?: () => void
}) {
  const isMonitorMode =
    selectedConversationId === CURATOR_PINNED_CONVERSATION_ID

  if (isMonitorMode) {
    return (
      <CuratorMonitorView
        contact={contact}
        onOpenConversations={onOpenConversations}
        onNewConversation={onNewConversation}
        className={className}
        {...props}
      />
    )
  }

  if (isDraftConversation || !selectedConversationId) {
    return (
      <CuratorDraftView
        contact={contact}
        onOpenContacts={onOpenContacts}
        onOpenConversations={onOpenConversations}
        onNewConversation={onNewConversation}
        className={className}
        {...props}
      />
    )
  }

  return (
    <CuratorConversationView
      contact={contact}
      selectedConversation={selectedConversation}
      conversationId={selectedConversationId}
      onOpenContacts={onOpenContacts}
      onOpenConversations={onOpenConversations}
      onNewConversation={onNewConversation}
      className={className}
      {...props}
    />
  )
}
