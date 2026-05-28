import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

import { useReconcileConversationSelection } from "@/lib/chat/conversation-selection"
import { useBootstrapCuratorDefaultConversation } from "@/hooks/use-bootstrap-curator-conversations"
import { useConversationsQuery } from "@/hooks/use-chat-queries"
import { useChatStore } from "@/stores/chat-store"

import { CuratorView } from "../curator/curator-view"
import { ConversationChatView } from "./chat-conversation-view"
import { DraftChatView } from "./chat-draft-view"

export function ChatView({
  onOpenContacts,
  onOpenConversations,
  onNewConversation,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  onOpenContacts?: () => void
  onOpenConversations?: () => void
  onNewConversation?: () => void
}) {
  const selectedContactId = useChatStore((s) => s.selectedContactId)
  const isDraftConversation = useChatStore((s) => s.isDraftConversation)
  const selectedConversationId = useChatStore((s) => s.selectedConversationId)
  const contact = useChatStore((s) => s.getSelectedContact())

  const {
    data: conversations = [],
    isSuccess: conversationsQuerySuccess,
  } = useConversationsQuery(selectedContactId, contact)

  useBootstrapCuratorDefaultConversation(
    contact,
    conversations,
    conversationsQuerySuccess
  )
  useReconcileConversationSelection(selectedContactId, contact)

  if (contact?.type === "curator") {
    const selectedConversation = conversations.find(
      (c) => String(c.id) === String(selectedConversationId)
    )

    if (isDraftConversation || !selectedConversationId) {
      return (
        <DraftChatView
          contact={contact}
          onOpenContacts={onOpenContacts}
          onOpenConversations={onOpenConversations}
          onNewConversation={onNewConversation}
          className={cn(className)}
          {...props}
        />
      )
    }

    return (
      <CuratorView
        key={String(selectedConversationId)}
        contact={contact}
        conversationId={selectedConversationId}
        title={selectedConversation?.title ?? "总管对话"}
        className={cn(className)}
        onOpenContacts={onOpenContacts}
        onOpenConversations={onOpenConversations}
        onNewConversation={onNewConversation}
        {...props}
      />
    )
  }

  const selectedConversation = conversations.find(
    (conversation) => String(conversation.id) === String(selectedConversationId)
  )

  return isDraftConversation || !selectedConversationId ? (
    <DraftChatView
      contact={contact}
      onOpenContacts={onOpenContacts}
      onOpenConversations={onOpenConversations}
      onNewConversation={onNewConversation}
      className={cn(className)}
      {...props}
    />
  ) : (
    <ConversationChatView
      key={String(selectedConversationId)}
      contact={contact}
      title={selectedConversation?.title ?? "新对话"}
      conversationId={selectedConversationId}
      onOpenContacts={onOpenContacts}
      onOpenConversations={onOpenConversations}
      onNewConversation={onNewConversation}
      className={cn(className)}
      {...props}
    />
  )
}
