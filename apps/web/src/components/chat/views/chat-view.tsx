import * as React from "react"

import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import {
  conversationExistsInList,
  useReconcileConversationSelection,
} from "@/lib/chat/conversation-selection"
import { useBootstrapCuratorDefaultConversation } from "@/hooks/use-bootstrap-curator-conversations"
import { useCuratorEnsureState } from "@/hooks/use-curator-ensure-state"
import { useConversationsQuery } from "@/hooks/use-chat-queries"
import { ensureCuratorConversationAndSelect } from "@/lib/chat/curator-conversation-actions"
import { useChatStore } from "@/stores/chat-store"
import type { Contact } from "@/types/chat"

import { CuratorView } from "../curator/curator-view"
import { ConversationChatView } from "./chat-conversation-view"
import { DraftChatView } from "./chat-draft-view"

function CuratorChatLoading({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full items-center justify-center text-sm text-muted-foreground",
        className
      )}
    >
      加载总管会话…
    </div>
  )
}

function CuratorEnsureRetry({
  contact,
  error,
  className,
}: {
  contact: Contact
  error: string
  className?: string
}) {
  const queryClient = useQueryClient()
  const [retrying, setRetrying] = React.useState(false)

  const handleRetry = () => {
    setRetrying(true)
    void ensureCuratorConversationAndSelect(queryClient, contact)
      .catch(() => {})
      .finally(() => setRetrying(false))
  }

  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center gap-3 px-6 text-center",
        className
      )}
    >
      <p className="text-sm text-muted-foreground">总管会话加载失败</p>
      <p className="text-xs text-muted-foreground">{error}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={retrying}
        onClick={handleRetry}
      >
        {retrying ? "重试中…" : "重试"}
      </Button>
    </div>
  )
}

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
  const { isEnsuring, error: ensureError } = useCuratorEnsureState()

  const {
    data: conversations = [],
    isSuccess: conversationsQuerySuccess,
    isFetching: conversationsFetching,
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
    const hasValidSelection =
      selectedConversationId != null &&
      (!conversationsQuerySuccess ||
        conversationExistsInList(conversations, selectedConversationId))

    if (hasValidSelection) {
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

    const awaitingEnsure =
      conversationsQuerySuccess && conversations.length === 0

    if (ensureError) {
      return (
        <CuratorEnsureRetry
          contact={contact}
          error={ensureError}
          className={cn(className)}
        />
      )
    }

    if (isEnsuring || conversationsFetching || awaitingEnsure) {
      return <CuratorChatLoading className={cn(className)} />
    }

    return (
      <CuratorEnsureRetry
        contact={contact}
        error="会话列表同步异常，请重试"
        className={cn(className)}
      />
    )
  }

  const selectedConversation = conversations.find(
    (conversation) => String(conversation.id) === String(selectedConversationId)
  )
  const hasValidSelection =
    selectedConversationId != null &&
    (!conversationsQuerySuccess ||
      conversationExistsInList(conversations, selectedConversationId))

  return isDraftConversation || !hasValidSelection ? (
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
