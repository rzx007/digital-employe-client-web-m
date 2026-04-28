import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

import { useConversationAutoSelect } from "@/hooks/use-conversation-auto-select"
import { useConversationsQuery } from "@/hooks/use-chat-queries"
import { useChatStore } from "@/stores/chat-store"

import { CuratorView } from "./curator-view"
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

  useConversationAutoSelect(selectedContactId, contact)
  const { data: conversations = [] } = useConversationsQuery(
    selectedContactId,
    contact
  )

  if (contact?.type === "curator") {
    return <CuratorView contact={contact} className={cn(className)} {...props} />
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
