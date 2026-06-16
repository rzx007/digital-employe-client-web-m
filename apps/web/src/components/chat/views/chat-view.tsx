import * as React from "react"

import { useQueryClient } from "@tanstack/react-query"
import { IconUsers } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { useIsMobile } from "@/hooks/use-mobile"

import {
  conversationExistsInList,
  getEmployeeDeepLinkConversationId,
  isPreservedEmployeeConversationSelection,
  useReconcileConversationSelection,
} from "@/lib/chat/conversation-selection"
import { useBootstrapCuratorDefaultConversation } from "@/hooks/use-bootstrap-curator-conversations"
import { useCuratorEnsureState } from "@/hooks/use-curator-ensure-state"
import { useConversationsQuery } from "@/hooks/use-chat-queries"
import { ensureCuratorConversationAndSelect } from "@/lib/chat/curator-conversation-actions"
import { useChatStore } from "@/stores/chat-store"
import type { Contact } from "@/types/chat"

import { EmployeeContactAvatar } from "../contacts/contact-avatars"
import { GrowthBrainSection } from "../contacts/growth-brain-section"
import { CuratorView } from "../curator/curator-view"
import { ConversationChatView } from "./chat-conversation-view"

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

/**
 * 员工只读成长面板（阶段4：员工单聊退场）。点击员工不再进单聊对话，
 * 改为查看其成长档案（能力画像/技能/记忆/学习日志）。派活统一走总管。
 */
function EmployeeGrowthView({
  contact,
  onOpenContacts,
  className,
}: {
  contact?: Contact
  onOpenContacts?: () => void
  className?: string
}) {
  const isMobile = useIsMobile()
  const employee = contact?.type === "employee" ? contact.employee : undefined

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center gap-3 border-b px-6 py-3">
        {isMobile && onOpenContacts && (
          <Button variant="ghost" size="icon-sm" onClick={onOpenContacts}>
            <IconUsers className="size-4" />
          </Button>
        )}
        <EmployeeContactAvatar
          name={employee?.name}
          avatar={employee?.avatar}
          status={employee?.status}
          showStatus
        />
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium">
            {employee?.name ?? "员工"}
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            成长档案 · 只读
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <GrowthBrainSection employeeId={employee?.id ?? null} />
      </div>
    </div>
  )
}

export function ChatView({
  onOpenContacts,
  onOpenConversations,
  onNewConversation,
  isNewConversationPending,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  onOpenContacts?: () => void
  onOpenConversations?: () => void
  onNewConversation?: () => void
  isNewConversationPending?: boolean
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
          isCreatingConversation={isNewConversationPending}
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
  const deepLinkConversationId = getEmployeeDeepLinkConversationId(
    selectedContactId,
    selectedConversationId
  )
  const hasValidSelection =
    selectedConversationId != null &&
    (!conversationsQuerySuccess ||
      conversationExistsInList(conversations, selectedConversationId) ||
      isPreservedEmployeeConversationSelection(
        selectedContactId,
        selectedConversationId,
        conversations
      ))
  const conversationTitle =
    selectedConversation?.title ??
    (deepLinkConversationId != null
      ? `任务执行 #${deepLinkConversationId}`
      : "任务执行")

  // 阶段4：员工单聊退场。普通选中/草稿 → 只读成长面板（不可对话）。
  // 仅当从总管/工作台深链进具体任务执行会话时 → 只读转录（隐藏输入区）。
  if (isDraftConversation || !hasValidSelection) {
    return (
      <EmployeeGrowthView
        contact={contact}
        onOpenContacts={onOpenContacts}
        className={cn(className)}
      />
    )
  }

  return (
    <ConversationChatView
      key={String(selectedConversationId)}
      contact={contact}
      title={conversationTitle}
      conversationId={selectedConversationId}
      onOpenContacts={onOpenContacts}
      onOpenConversations={onOpenConversations}
      readOnly
      className={cn(className)}
      {...props}
    />
  )
}
