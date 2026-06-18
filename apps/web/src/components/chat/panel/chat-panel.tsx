import * as React from "react"
import type { UIMessage } from "ai"
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@workspace/ui/components/ai-elements/conversation"

import type { PromptInputMessage } from "@workspace/ui/components/ai-elements/prompt-input"
import { cn } from "@workspace/ui/lib/utils"
import { IconSparkles } from "@tabler/icons-react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useStickToBottomContext } from "use-stick-to-bottom"
import logo from "@/assets/logo.png"
import { useChatStore } from "@/stores/chat-store"

import { ChatComposerArea } from "./chat-composer-area"
import type { PromptChangeEvent } from "@/components/lexical-editor/prompt-input-textarea"
import type { SlashCommandItem } from "@/components/lexical-editor/slash-command-plugin"
import type { MentionCandidate } from "@/components/lexical-editor/mention-plugin"
import { ChatPanelHeader } from "./chat-panel-header"
import { CuratorReturnBar } from "../curator/curator-return-bar"
import type { PendingMessage } from "@/hooks/use-pending-messages"
import {
  isAssistantQueued,
  isStoredAssistantQueued,
  isTerminalAssistantStreamState,
} from "@/lib/chat/assistant-stream-state"
import { ChatStreamingIndicator } from "./chat-streaming-indicator"
import { MessageLoadingSkeleton } from "./message-loading-skeleton"
import {
  getContactDisplayName,
  type ChatViewContact,
} from "../shared/chat-view-shared"
import type { ActiveHitl, HitlPatchOptions } from "@/lib/chat/hitl"
import { shouldIncludeFileChangesForMessage } from "@/lib/chat/file-change-utils"
import { ChatMessageItem } from "../messages/chat-message-item"
import { CuratorEmptyWelcome } from "../curator/curator-empty-welcome"
import { useSyncConversationSubtasks } from "@/hooks/use-conversation-subtasks"

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
  conversationId?: string | number | null
  activeHitl?: ActiveHitl | null
  onHitlApproved?: (options?: HitlPatchOptions) => void
}

function VirtualizedMessageList({
  messages,
  contact,
  hasCurrentTurnEnded,
  conversationId,
  activeHitl,
  onHitlApproved,
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
        const includeFileChanges = shouldIncludeFileChangesForMessage(
          message,
          messages,
          hasCurrentTurnEnded
        )

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
              isLastAssistantMessage={isLastAssistantMessage}
              isTurnEnded={hasCurrentTurnEnded}
              conversationId={conversationId}
              activeHitl={activeHitl}
              onHitlApproved={onHitlApproved}
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
  composerMessages,
  storedAssistantStreamState,
  hideStreamingIndicator = false,
  activeHitl = null,
  onHitlApproved,
  onDraftSuggestionSelect,
  hideHeader = false,
  readOnly = false,
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
  composerMessages?: UIMessage[]
  /** DB 侧最后一条 assistant 的 streamState，用于抑制误显示的 streaming 指示器 */
  storedAssistantStreamState?: string | null
  /** 群深链执行会话：只读 DB 快照，不显示底部「正在生成…」 */
  hideStreamingIndicator?: boolean
  activeHitl?: ActiveHitl | null
  onHitlApproved?: (options?: HitlPatchOptions) => void
  /** 总管草稿：引导语填入输入框 */
  onDraftSuggestionSelect?: (text: string) => void
  /** 工作台 compact：外层已有 CuratorCompactToolbar */
  hideHeader?: boolean
  /** 只读模式：隐藏底部输入区（如员工任务执行会话钻取，仅查看转录） */
  readOnly?: boolean
}) {
  const contactDisplayName = contact
    ? getContactDisplayName(contact)
    : "AI 助手"

  // 把当前会话的并行子任务（task 工具调用）聚合进 subtask-panel-store，
  // 供右侧子任务面板展示。用 composer（含实时流式 preliminary 输出）作为数据源。
  useSyncConversationSubtasks(composerMessages ?? messages)

  const displayMessages = isDraftMode ? EMPTY_MESSAGES : messages
  const hasCurrentTurnEnded =
    status === "ready" || status === "error" || !!error
  const showStreamingIndicator =
    !hideStreamingIndicator &&
    !isDraftMode &&
    // 本地 SSE 假结束但后端仍在跑(DB streamState=streaming)时也显示忙碌——
    // 让用户知道总管仍在执行(子任务进行中),发送会进排队而非抢占。
    (status === "submitted" ||
      status === "streaming" ||
      storedAssistantStreamState === "streaming") &&
    !error &&
    displayMessages.length > 0 &&
    !isAssistantQueued(composerMessages ?? messages) &&
    !isStoredAssistantQueued(storedAssistantStreamState) &&
    !isTerminalAssistantStreamState(storedAssistantStreamState ?? undefined)

  const slashCommands = React.useMemo<SlashCommandItem[]>(() => {
    const skills =
      contact?.type === "employee" ? contact.employee?.skills : undefined
    if (!skills?.length) return []
    return skills.map((skill) => ({
      id: String(skill.id),
      title: skill.skill_name_zh ?? skill.skillName ?? skill.skill_name ?? "",
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

  const handleComposerSend = React.useCallback(
    (message: PromptInputMessage | string) => {
      const payload: PromptInputMessage =
        typeof message === "string" ? { text: message, files: [] } : message
      void onSend(payload)
    },
    [onSend]
  )

  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col bg-background", className)}
      {...props}
    >
      {contact && (
        <>
          {!hideHeader && (
            <ChatPanelHeader
              title={title}
              contact={contact}
              onOpenContacts={onOpenContacts}
              onOpenConversations={onOpenConversations}
              onNewConversation={onNewConversation}
            />
          )}
          <CuratorReturnBar />
          <>
            <Conversation className="min-h-0 flex-1 pt-4">
              <ConversationContent className="px-4 pb-4">
                {isDraftMode ? (
                  contact.type === "curator" ? (
                    <CuratorEmptyWelcome
                      contact={contact}
                      displayName={contactDisplayName}
                      onSuggestionSelect={onDraftSuggestionSelect ?? (() => {})}
                      suggestionsDisabled={
                        status === "submitted" || status === "streaming"
                      }
                    />
                  ) : (
                    <ConversationEmptyState className="py-16">
                      <div className="flex flex-col items-center gap-6">
                        <img
                          src={logo}
                          alt="Logo"
                          className="w-12 opacity-80"
                        />
                        <div className="space-y-3 text-center">
                          <h2 className="text-md font-semibold tracking-tight">
                            数字员工智能助手
                          </h2>
                          <p className="text-sm text-muted-foreground">
                            随时为您解答问题、处理任务、提升效率
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center justify-center gap-3">
                          {[
                            "智能问答",
                            "数据分析",
                            "文档生成",
                            "流程自动化",
                          ].map((label) => (
                            <span
                              key={label}
                              className="rounded-full border border-border/60 bg-muted/50 px-3 py-1 text-xs text-muted-foreground"
                            >
                              {label}
                            </span>
                          ))}
                        </div>
                      </div>
                    </ConversationEmptyState>
                  )
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
                    conversationId={conversationId}
                    activeHitl={activeHitl}
                    onHitlApproved={onHitlApproved}
                  />
                )}

                {showStreamingIndicator && (
                  <ChatStreamingIndicator
                    status={status}
                    messages={composerMessages ?? messages}
                    className="mx-auto -mt-10 max-w-4xl"
                  />
                )}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>

            {readOnly ? (
              <div className="mx-auto w-full max-w-4xl px-1 py-3 text-center text-xs text-muted-foreground">
                只读 · 仅查看执行记录，如需派活请通过总管
              </div>
            ) : (
              <div className="mx-auto w-full max-w-4xl border-none px-1 py-4">
                <ChatComposerArea
                  messages={composerMessages ?? messages}
                  conversationId={conversationId!}
                  inputValue={inputValue}
                  onInputChange={onInputChange}
                  onSend={handleComposerSend}
                  onStop={() => onStop?.()}
                  onHitlApproved={onHitlApproved}
                  activeHitl={activeHitl}
                  status={status}
                  submitDisabled={isSubmitDisabled}
                  placeholder="请输入任务，然后交给我, 键入 / 指定调用技能"
                  size="compact"
                  className="w-full"
                  slashCommands={slashCommands}
                  mentionCandidates={mentionCandidates}
                  onAttachmentsChange={onAttachmentsChange}
                  pendingMessages={pendingMessages}
                  onPendingRemove={onPendingRemove}
                  onPendingSendNow={onPendingSendNow}
                  onPendingMoveUp={onPendingMoveUp}
                  onPendingMoveDown={onPendingMoveDown}
                  error={error}
                  pendingQueueClassName="mx-auto w-[98%]"
                />
              </div>
            )}
          </>
        </>
      )}
    </div>
  )
}
