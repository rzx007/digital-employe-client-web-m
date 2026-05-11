import * as React from "react"
import type { UIMessage } from "ai"
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@workspace/ui/components/ai-elements/conversation"
import { Shimmer } from "@workspace/ui/components/ai-elements/shimmer"
import {
  Message,
  MessageContent,
} from "@workspace/ui/components/ai-elements/message"
import type { PromptInputMessage } from "@workspace/ui/components/ai-elements/prompt-input"
import { cn } from "@workspace/ui/lib/utils"
import { IconSparkles } from "@tabler/icons-react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useStickToBottomContext } from "use-stick-to-bottom"
import logo from "@/assets/logo.png"
import { Spinner } from "@/components/spinner"
import { useChatStore } from "@/stores/chat-store"

import { ChatPromptInput } from "@/components/chat-prompt-input"
import type { PromptChangeEvent } from "@/components/lexical-editor/prompt-input-textarea"
import type { SlashCommandItem } from "@/components/lexical-editor/slash-command-plugin"
import type { MentionCandidate } from "@/components/lexical-editor/mention-plugin"
import { ChatPanelHeader } from "./chat-panel-header"
import { PendingMessageQueue } from "./pending-message-queue"
import type { PendingMessage } from "@/hooks/use-pending-messages"
import { MessageLoadingSkeleton } from "./message-loading-skeleton"
import {
  getContactDisplayName,
  type ChatViewContact,
} from "../shared/chat-view-shared"
import { ChatMessageItem } from "../messages/chat-message-item"

const EMPTY_MESSAGES: UIMessage[] = []

function getLastAssistantMessageId(messages: UIMessage[]) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role === "assistant") {
      return message.id
    }
  }
  return null
}

type VirtualizedMessageListProps = {
  messages: UIMessage[]
  contact: ChatViewContact
  hasCurrentTurnEnded: boolean
}

function VirtualizedMessageList({
  messages,
  contact,
  hasCurrentTurnEnded,
}: VirtualizedMessageListProps) {
  const { scrollRef } = useStickToBottomContext()
  const lastAssistantMessageId = getLastAssistantMessageId(messages)
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 200,
    overscan: 5,
  })

  const measureRef = React.useCallback(
    (el: HTMLElement | null) => {
      virtualizer.measureElement(el)
    },
    [virtualizer]
  )

  const prevCountRef = React.useRef(messages.length)
  React.useEffect(() => {
    if (messages.length > prevCountRef.current && messages.length > 0) {
      virtualizer.scrollToIndex(messages.length - 1, { align: "end" })
    }
    prevCountRef.current = messages.length
  }, [messages.length, virtualizer])

  const items = virtualizer.getVirtualItems()

  return (
    <div
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        width: "100%",
        position: "relative",
      }}
    >
      {items.map((virtualItem) => {
        const message = messages[virtualItem.index]
        const isLastAssistantMessage =
          message.role === "assistant" && message.id === lastAssistantMessageId
        const includeFileChanges =
          message.role === "assistant" &&
          (!isLastAssistantMessage || hasCurrentTurnEnded)

        return (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={measureRef}
            className="pb-8"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <ChatMessageItem
              message={message}
              contact={contact}
              includeFileChanges={includeFileChanges}
            />
          </div>
        )
      })}
    </div>
  )
}

export function ChatPanel({
  contact,
  title,
  messages,
  inputValue,
  status,
  error,
  isDraftMode,
  isMessagesLoading,
  isSubmitDisabled,
  onInputChange,
  onSend,
  onStop,
  onOpenContacts,
  onOpenConversations,
  onNewConversation,
  pendingMessages,
  onPendingRemove,
  onPendingSendNow,
  onPendingMoveUp,
  onPendingMoveDown,
  conversationId,
  onAttachmentsChange,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  contact?: ChatViewContact
  title: string
  messages: UIMessage[]
  inputValue: string
  status: "submitted" | "streaming" | "ready" | "error"
  error?: Error
  isDraftMode: boolean
  isMessagesLoading?: boolean
  isSubmitDisabled: boolean
  onInputChange: (event: PromptChangeEvent) => void
  onSend: (message: PromptInputMessage) => Promise<void>
  onStop?: () => void
  onOpenContacts?: () => void
  onOpenConversations?: () => void
  onNewConversation?: () => void
  pendingMessages?: PendingMessage[]
  onPendingRemove?: (id: string) => void
  onPendingSendNow?: (id: string) => void
  onPendingMoveUp?: (id: string) => void
  onPendingMoveDown?: (id: string) => void
  conversationId?: string | number | null
  onAttachmentsChange?: (paths: string[]) => void
}) {
  const contactDisplayName = contact
    ? getContactDisplayName(contact)
    : "AI 助手"

  const displayMessages = isDraftMode ? EMPTY_MESSAGES : messages
  const hasCurrentTurnEnded =
    status === "ready" || status === "error" || !!error
  const showStreamingIndicator =
    !isDraftMode &&
    (status === "submitted" || status === "streaming") &&
    !error &&
    displayMessages.length > 0

  const slashCommands = React.useMemo<SlashCommandItem[]>(() => {
    const skills =
      contact?.type === "employee" ? contact.employee?.skills : undefined
    if (!skills?.length) return []
    return skills.map((skill) => ({
      id: String(skill.id),
      title: skill.skillName || skill.skill_name,
      icon: <IconSparkles className="h-4 w-4" />,
      description: skill.description || skill.skill_description || "",
      keywords: [
        skill.skill_name ? skill.skill_name.toLowerCase() : "",
        ...(skill.skill_description
          ? skill.skill_description.toLowerCase().split(/\s+/).slice(0, 3)
          : []),
      ],
    }))
  }, [contact])

  const mentionCandidates = React.useMemo<MentionCandidate[]>(() => {
    if (contact?.type === "group") {
      return (contact.group?.participants ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        role: p.role,
      }))
    }
    if (contact?.type === "curator") {
      const { contacts } = useChatStore.getState()
      return contacts
        .filter((c) => c.type === "employee" && c.employee)
        .map((c) => ({
          id: c.employee!.id,
          name: c.employee!.name,
          avatar: c.employee!.avatar,
          role: c.employee!.role,
        }))
    }
    return []
  }, [contact])

  return (
    <div
      className={cn("flex flex-1 flex-col bg-background", className)}
      {...props}
    >
      {contact && (
        <>
          <ChatPanelHeader
            title={title}
            contact={contact}
            onOpenContacts={onOpenContacts}
            onOpenConversations={onOpenConversations}
            onNewConversation={onNewConversation}
          />
          <>
            <Conversation className="min-h-0 flex-1 overflow-y-auto pt-4">
              <ConversationContent className="px-4 pb-4">
                {isDraftMode ? (
                  <ConversationEmptyState className="py-16">
                    <div className="flex flex-col items-center gap-6">
                      <img src={logo} alt="Logo" className="w-12 opacity-80" />
                      <div className="space-y-3 text-center">
                        <h2 className="text-md font-semibold tracking-tight">
                          数字员工智能助手
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          随时为您解答问题、处理任务、提升效率
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-3">
                        {["智能问答", "数据分析", "文档生成", "流程自动化"].map(
                          (label) => (
                            <span
                              key={label}
                              className="rounded-full border border-border/60 bg-muted/50 px-3 py-1 text-xs text-muted-foreground"
                            >
                              {label}
                            </span>
                          )
                        )}
                      </div>
                    </div>
                  </ConversationEmptyState>
                ) : isMessagesLoading ? (
                  <MessageLoadingSkeleton />
                ) : displayMessages.length === 0 ? (
                  <ConversationEmptyState className="py-16">
                    <div className="flex flex-col items-center gap-5">
                      <img src={logo} alt="Logo" className="w-14 opacity-50" />
                      <div className="space-y-1.5 text-center">
                        <h3 className="text-sm font-medium">开始新对话</h3>
                        <p className="text-xs text-muted-foreground">
                          在下方输入消息，开启与 {contactDisplayName} 的对话
                        </p>
                      </div>
                    </div>
                  </ConversationEmptyState>
                ) : (
                  <VirtualizedMessageList
                    messages={displayMessages}
                    contact={contact}
                    hasCurrentTurnEnded={hasCurrentTurnEnded}
                  />
                )}

                {showStreamingIndicator && (
                  <Message
                    from="assistant"
                    className="mx-auto -mt-10 max-w-4xl"
                  >
                    <MessageContent className="rounded-lg bg-muted/40 px-3 py-2.5">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Spinner
                          className="size-3.5"
                          style={{ color: "#8B5CF6" }}
                        />
                        <Shimmer className="text-xs">正在生成回复...</Shimmer>
                      </div>
                    </MessageContent>
                  </Message>
                )}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>

            <div className="mx-auto w-full max-w-4xl border-none py-4 px-1">
              {pendingMessages && pendingMessages.length > 0 && (
                <div className="mx-auto w-[98%]">
                  <PendingMessageQueue
                    queue={pendingMessages}
                    onRemove={onPendingRemove ?? (() => { })}
                    onSendNow={onPendingSendNow ?? (() => { })}
                    onMoveUp={onPendingMoveUp ?? (() => { })}
                    onMoveDown={onPendingMoveDown ?? (() => { })}
                  />
                </div>
              )}
              <ChatPromptInput
                value={inputValue}
                onChange={onInputChange}
                onSubmit={onSend}
                onStop={onStop}
                status={status}
                disabled={isSubmitDisabled}
                placeholder="请输入任务，然后交给我, 键入 / 指定调用技能"
                size="compact"
                className="w-full overflow-hidden bg-background/80 shadow-xl"
                slashCommands={slashCommands}
                mentionCandidates={mentionCandidates}
                conversationId={conversationId}
                onAttachmentsChange={onAttachmentsChange}
              />
              {error && (
                <p className="mt-2 text-xs text-destructive">{error.message}</p>
              )}
            </div>
          </>
        </>
      )}
    </div>
  )
}
