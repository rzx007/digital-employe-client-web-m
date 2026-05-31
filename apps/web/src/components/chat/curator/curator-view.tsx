import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  type ComponentProps,
} from "react"
import { useQueryClient } from "@tanstack/react-query"
import { cn } from "@workspace/ui/lib/utils"
import { useChat } from "@ai-sdk/react"
import type { UIMessage } from "ai"
import type { PromptInputMessage } from "@workspace/ui/components/ai-elements/prompt-input"
import type { PromptChangeEvent } from "@/components/lexical-editor/prompt-input-textarea"
import {
  Conversation as ConversationUI,
  ConversationContent,
  ConversationScrollButton,
} from "@workspace/ui/components/ai-elements/conversation"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@workspace/ui/components/ai-elements/message"
import { Shimmer } from "@workspace/ui/components/ai-elements/shimmer"
import { Spinner } from "@/components/spinner"
import {
  getCopyableMessageText,
  mapStoredMessagesToUIMessages,
} from "@/lib/chat/message-utils"
import { shouldIncludeFileChangesForMessage } from "@/lib/chat/file-change-utils"
import { useConversationSession } from "@/hooks/use-conversation-session"
import { useInvalidateContactsOnTeamChanges } from "@/hooks/use-invalidate-contacts-on-team-changes"
import { useSyncPendingFromComposer } from "@/hooks/use-sync-pending-from-composer"
import {
  useMessagesQuery,
  useResetCuratorConversation,
  useUpdateConversationTitleMutation,
} from "@/hooks/use-chat-queries"
import { usePendingMessages } from "@/hooks/use-pending-messages"
import { useChatStore } from "@/stores/chat-store"
import { useCuratorTaskExecutions } from "@/hooks/use-schedule-monitor-queries"
import { cancelConversationStream } from "@/api/chat"
import { shouldRenameCuratorConversationOnFirstMessage } from "@/lib/chat/curator-conversation-actions"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { chatTransport, type ChatViewContact } from "../shared/chat-view-shared"
import { CuratorChatHeader } from "../contacts/curator-chat-header"
import { CuratorCompactToolbar } from "./curator-compact-toolbar"
import { getCuratorLayout } from "./curator-layout"
import { ExecutionReportCard } from "../message-blocks/execution-report-card"
import { ChatComposerArea } from "../panel/chat-composer-area"
import { CuratorRotatingPlaceholder } from "./curator-rotating-placeholder"
import { CuratorEmptyWelcome } from "./curator-empty-welcome"
import { CuratorFileProvider } from "./curator-file-provider"
import { CuratorRecruitmentProvider } from "./curator-recruitment-provider"
import { CuratorPlanFeedbackProvider } from "./curator-plan-feedback-context"
import { useArtifactStore } from "@/stores/artifact-store"
import { EmployeeContactAvatar } from "../contacts/contact-avatars"
import {
  getElapsedMsFromMeta,
  getMessageCreatedAtMs,
} from "../shared/chat-view-shared"
import { MessageAssistantActions } from "../messages/message-assistant-actions"
import { MessageCopyAction } from "../messages/message-copy-action"
import { format } from "date-fns"
import { zhCN } from "date-fns/locale"
import type { TaskExecution } from "@/types/schedule-monitor"
import type { Message as ChatMessage } from "@/types/chat"
import { curatorUnreadKey } from "@/lib/constants"
import {
  buildRecruitmentHireAllMessage,
  buildRecruitmentHireMessage,
  type RecruitmentCandidateItem,
} from "@/lib/chat/recruitment-tool-payload"
import { chatKeys } from "@/lib/query-keys/chat"
import { useConversationStatusStore } from "@/stores/conversation-status-store"
import {
  prepareDisplayMessages,
  resolveHitlApproveMessageId,
} from "@/lib/chat/hitl"
import { pickMessageDisplaySource } from "@/lib/chat/pick-message-display-source"

type TimelineEntry =
  | { kind: "message"; data: UIMessage; ts: number }
  | { kind: "execution"; data: TaskExecution; ts: number }

function getMsgTs(
  msg: UIMessage,
  storedMessages: Array<{
    id: string
    metadata?: Record<string, unknown>
    timestamp?: Date
  }>
): number {
  return getMessageCreatedAtMs(msg, storedMessages) ?? 0
}

const TERMINAL_EXECUTION_STATUSES = new Set([
  "success",
  "failed",
  "timeout",
  "cancelled",
])

function getExecutionTimelineTs(exec: TaskExecution): number | null {
  const raw = exec.ended_at ?? exec.started_at
  if (!raw) return null
  const ms = new Date(raw).getTime()
  return Number.isFinite(ms) ? ms : null
}

function getMaxExecutionTimelineTs(executions: TaskExecution[]): number {
  let max = 0
  for (const exec of executions) {
    if (!TERMINAL_EXECUTION_STATUSES.has(exec.run_status)) continue
    const ts = getExecutionTimelineTs(exec)
    if (ts != null && ts > max) max = ts
  }
  return max
}

/** 摘要消息 execution_log_id → 时间戳（用于卡片排在摘要下方） */
function buildExecutionSummaryTsMap(storedMessages: ChatMessage[]): Map<number, number> {
  const map = new Map<number, number>()
  for (const msg of storedMessages) {
    if (msg.role !== "assistant") continue
    const meta = msg.metadata
    if (!meta || typeof meta !== "object") continue
    if (meta.source !== "orchestrator_execution_summary") continue
    const execId = meta.execution_log_id
    if (typeof execId !== "number") continue
    const ts = msg.timestamp?.getTime()
    if (ts != null && Number.isFinite(ts)) {
      map.set(execId, ts)
    }
  }
  return map
}

function formatTime(ts: number): string {
  return format(new Date(ts), "HH:mm", { locale: zhCN })
}

import { BlockRenderer } from "../message-blocks/block-render-map"
import { useClassifiedMessageBlocks } from "@/hooks/use-classified-message-blocks"

function CuratorMessageItem({
  message,
  isLastAssistantMessage,
  hasCurrentTurnEnded,
  includeFileChanges,
  layout,
  resolvedContact,
  contactDisplayName,
  ts,
  session,
  curatorConversationId,
  onSendUserMessage,
}: {
  message: UIMessage
  isLastAssistantMessage: boolean
  hasCurrentTurnEnded: boolean
  includeFileChanges: boolean
  layout: Record<string, string>
  resolvedContact: ChatViewContact | undefined | null
  contactDisplayName: string
  ts: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any
  curatorConversationId: string | number | null
  onSendUserMessage?: (text: string) => Promise<void>
}) {
  const {
    blocks: classifiedBlocks,
    toolAutoCollapseMap,
    commandMeta,
    mentionMeta,
    filesMeta,
  } = useClassifiedMessageBlocks(message, {
    includeFileChanges,
    isLastAssistantMessage,
    isTurnEnded: hasCurrentTurnEnded,
  })
  
  const elapsedMs = getElapsedMsFromMeta(message)
  const copyText = getCopyableMessageText(message, { includeFileChanges })
  const hitlApproveMessageId = resolveHitlApproveMessageId(message, session.activeHitl)
  const ctx = {
    messageId: hitlApproveMessageId,
    conversationId: curatorConversationId,
    toolAutoCollapseMap,
    isLastAssistantMessage,
    isTurnEnded: hasCurrentTurnEnded,
    onHitlApproved: session.onHitlApproved,
    onSendUserMessage,
    commandMeta: commandMeta ?? {},
    mentionMeta,
    filesMeta,
  }

  return (
    <Message
      from={message.role}
      className={cn("group", layout.message)}
    >
      {message.role === "assistant" && (
        <div className="mb-2 flex items-center gap-2">
          {resolvedContact?.type === "curator" ? (
            <EmployeeContactAvatar
              name={resolvedContact.curator?.name}
              avatar={resolvedContact.curator?.avatar}
              status={resolvedContact.curator?.status}
              avatarClassName="size-6"
              fallbackClassName="text-[10px]"
            />
          ) : resolvedContact?.type === "employee" ? (
            <EmployeeContactAvatar
              name={resolvedContact.employee?.name}
              avatar={resolvedContact.employee?.avatar}
              avatarClassName="size-6"
              fallbackClassName="text-[10px]"
            />
          ) : (
            <EmployeeContactAvatar
              name={contactDisplayName}
              avatar={undefined}
              avatarClassName="size-6"
              fallbackClassName="text-[10px]"
            />
          )}
          <span className="text-xs text-muted-foreground">
            {contactDisplayName}
          </span>
          <span className="ml-auto text-[10px] text-muted-foreground/60">
            {formatTime(ts)}
          </span>
        </div>
      )}
      <MessageContent className="w-auto">
        <div className="space-y-3">
          {classifiedBlocks.length > 0 ? (
            classifiedBlocks.map((block) => (
              <BlockRenderer key={block.key} block={block} ctx={ctx} />
            ))
          ) : message.role === "assistant" ? (
            <MessageResponse />
          ) : null}
        </div>
      </MessageContent>
      {message.role === "assistant" ? (
        <MessageAssistantActions
          copyText={copyText}
          elapsedMs={elapsedMs}
          isLastAssistantMessage={isLastAssistantMessage}
          isTurnEnded={hasCurrentTurnEnded}
        />
      ) : (
        <MessageCopyAction text={copyText} />
      )}
    </Message>
  )
}

export function CuratorView({
  contact,
  conversationId: conversationIdProp,
  title: conversationTitle,
  size = "default",
  resourcesOpen,
  onToggleResources,
  onOpenResourceFile,
  onOpenContacts,
  onOpenConversations,
  onNewConversation,
  className,
  ...props
}: ComponentProps<"div"> & {
  contact?: ChatViewContact
  conversationId: string | number
  title?: string
  size?: "default" | "compact"
  /** compact 工作台：由 WorkbenchContentSplit 控制资源分栏 */
  resourcesOpen?: boolean
  onToggleResources?: () => void
  /** 工作台：打开资源面板并选中文件 */
  onOpenResourceFile?: (path: string) => void
  onOpenContacts?: () => void
  onOpenConversations?: () => void
  onNewConversation?: () => void
}) {
  const [inputValue, setInputValue] = useState("")
  const [command, setCommand] = useState<{ id: string; title: string } | null>(
    null
  )
  const [mentions, setMentions] = useState<Array<{ id: string; name: string }>>(
    []
  )
  const [showResetDialog, setShowResetDialog] = useState(false)
  const [clearTaskLogs, setClearTaskLogs] = useState(true)
  const resetMutation = useResetCuratorConversation()
  const updateTitleMutation = useUpdateConversationTitleMutation()
  const queryClient = useQueryClient()
  const curatorConversationId = conversationIdProp
  const curatorContactId = contact?.curator?.id
  const openResource = useArtifactStore((s) => s.openResource)

  useEffect(() => {
    const curatorId = contact?.curator?.id
    if (!curatorId) return
    useConversationStatusStore
      .getState()
      .clearUnreadByContactKey(curatorUnreadKey(curatorId))
  }, [contact?.curator?.id])

  const { data: storedMessages = [], isPending: isMessagesLoading } =
    useMessagesQuery(curatorConversationId)

  const initialMessages = useMemo(
    () =>
      storedMessages?.length
        ? mapStoredMessagesToUIMessages(storedMessages)
        : [],
    [storedMessages]
  )

  const onStreamFinishRef = useRef<() => void>(() => {})

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    error,
    stop,
    resumeStream,
  } = useChat({
    id: String(curatorConversationId ?? "curator-persistent"),
    transport: chatTransport,
    onFinish: () => {
      onStreamFinishRef.current()
    },
    onError: (chatError) => {
      toast.error("发送失败", {
        description: chatError.message || "请稍后重试",
      })
    },
  })

  const session = useConversationSession({
    conversationId: curatorConversationId,
    storedMessages,
    initialMessages,
    composerMessages: messages,
    status,
    setMessages,
    resumeStream,
    queryClient,
  })

  useSyncPendingFromComposer(curatorConversationId, messages, status)

  useInvalidateContactsOnTeamChanges(messages, status, queryClient)

  useEffect(() => {
    onStreamFinishRef.current = session.onStreamFinish
  }, [session.onStreamFinish])

  const handleStop = useCallback(async () => {
    stop()
    chatTransport.cancelReconnect()
    if (curatorConversationId) {
      try {
        await cancelConversationStream(curatorConversationId)
      } catch {
        /* best-effort cancel */
      }
    }
    session.onStreamStopped()
  }, [stop, curatorConversationId, session])

  useEffect(() => {
    return () => {
      stop()
      chatTransport.cancelReconnect()
    }
  }, [stop])

  const handleReset = useCallback(async () => {
    if (!curatorConversationId || !curatorContactId) return
    try {
      await resetMutation.mutateAsync({
        conversationId: curatorConversationId,
        contactId: curatorContactId,
        clearTaskLogs,
      })
      queryClient.setQueryData(
        chatKeys.messages(String(curatorConversationId)),
        []
      )
      setMessages([])
      setShowResetDialog(false)
      toast.success("会话已清空")
    } catch {
      toast.error("清空失败")
    }
  }, [
    curatorConversationId,
    curatorContactId,
    clearTaskLogs,
    resetMutation,
    setMessages,
    queryClient,
  ])

  const handleTextChange = useCallback((event: PromptChangeEvent) => {
    setCommand(event.command)
    setMentions(event.mentions)
    setInputValue(event.value)
  }, [])

  const isBusy = status === "submitted" || status === "streaming"
  const chatStatus = status === "ready" && isBusy ? "submitted" : status

  const displayMessages = useMemo(() => {
    const source = pickMessageDisplaySource(messages, initialMessages, status)
    return prepareDisplayMessages(source)
  }, [messages, initialMessages, status])

  const lastAssistantMessageId = useMemo(() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      if (displayMessages[i].role === "assistant") return displayMessages[i].id
    }
    return null
  }, [displayMessages])

  const hasCurrentTurnEnded =
    status === "ready" || status === "error" || !!error
  const showStreamingIndicator =
    !isMessagesLoading &&
    (status === "submitted" || status === "streaming") &&
    !error &&
    displayMessages.length > 0

  const uploadedPathsRef = useRef<string[]>([])
  const chatStatusRef = useRef(status)

  useEffect(() => {
    chatStatusRef.current = status
  }, [status])

  const waitForChatReady = useCallback(async () => {
    for (let i = 0; i < 40; i++) {
      const current = chatStatusRef.current
      if (current === "ready" || current === "error") return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }, [])

  const doSend = useCallback(
    async (message: PromptInputMessage | string) => {
      const messageText =
        (typeof message === "string" ? message : message.text)?.trim() ?? ""
      if (!messageText || !curatorConversationId) return

      const paths = uploadedPathsRef.current
      if (paths.length > 0) {
        uploadedPathsRef.current = []
      }
      const filesMeta =
        paths.length > 0
          ? paths.map((p) => ({ path: p, name: p.split("/").pop() ?? p }))
          : undefined

      const pendingMeta = {
        command: command ? { id: command.id, title: command.title } : undefined,
        mentions: mentions.length > 0 ? mentions : undefined,
        files: filesMeta,
      }

      try {
        session.prepareOutboundMessage()
        const shouldUpdateTitle =
          shouldRenameCuratorConversationOnFirstMessage(conversationTitle) &&
          displayMessages.length === 0

        await sendMessage(
          { text: messageText, metadata: pendingMeta },
          {
            body: {
              conversationId: curatorConversationId,
              skill: command?.title ?? "",
              metadata: pendingMeta,
            },
          }
        )

        if (
          shouldUpdateTitle &&
          curatorContactId &&
          contact?.type === "curator"
        ) {
          const nextTitle = messageText.slice(0, 50)
          void updateTitleMutation
            .mutateAsync({
              conversationId: curatorConversationId,
              title: nextTitle,
              contactId: curatorContactId,
            })
            .catch(() => {
              toast.error("更新会话标题失败")
            })
        }
      } catch (sendError) {
        toast.error("发送失败", {
          description:
            sendError instanceof Error ? sendError.message : "请稍后重试",
        })
      }
    },
    [curatorConversationId, sendMessage, command, mentions, session, conversationTitle, displayMessages.length, curatorContactId, contact, updateTitleMutation]
  )

  const handleGuidanceSelect = useCallback(
    (text: string) => {
      if (isBusy || !curatorConversationId) {
        setInputValue(text)
        return
      }
      void doSend(text)
    },
    [isBusy, curatorConversationId, doSend]
  )

  const handleAttachmentsChange = useCallback((paths: string[]) => {
    uploadedPathsRef.current = paths
  }, [])

  const {
    queue: pendingQueue,
    enqueue,
    remove: pendingRemove,
    sendNow: pendingSendNow,
    moveUp: pendingMoveUp,
    moveDown: pendingMoveDown,
  } = usePendingMessages({ status, onSend: doSend, onStop: handleStop })

  const sendFeedbackMessage = useCallback(
    async (text: string) => {
      const messageText = text.trim()
      if (!messageText || !curatorConversationId) {
        throw new Error("会话未就绪，无法发送反馈")
      }

      if (isBusy) {
        await handleStop()
        await waitForChatReady()
      }

      session.prepareOutboundMessage()
      await sendMessage(
        { text: messageText },
        {
          body: {
            conversationId: curatorConversationId,
            skill: "",
            metadata: {},
          },
        }
      )

      void queryClient.invalidateQueries({
        queryKey: chatKeys.messages(String(curatorConversationId)),
      })
    },
    [
      curatorConversationId,
      handleStop,
      isBusy,
      queryClient,
      sendMessage,
      session,
      waitForChatReady,
    ]
  )

  const curatorPlanFeedbackValue = useMemo(
    () => ({ sendPlanFeedback: sendFeedbackMessage }),
    [sendFeedbackMessage]
  )

  const handleRecruitmentHire = useCallback(
    (candidate: RecruitmentCandidateItem) => {
      const text = buildRecruitmentHireMessage(candidate)
      if (!curatorConversationId) {
        toast.error("会话未就绪，请稍后再试")
        return
      }
      if (isBusy) {
        enqueue({
          id: `pending-hire-${Date.now()}`,
          text,
          command: null,
        })
        toast.success("已加入发送队列", { description: text })
        return
      }
      void doSend(text)
    },
    [curatorConversationId, isBusy, enqueue, doSend]
  )

  const handleRecruitmentHireAll = useCallback(
    (candidates: RecruitmentCandidateItem[]) => {
      const text = buildRecruitmentHireAllMessage(candidates)
      if (!curatorConversationId) {
        toast.error("会话未就绪，请稍后再试")
        return
      }
      if (isBusy) {
        enqueue({
          id: `pending-hire-all-${Date.now()}`,
          text,
          command: null,
        })
        toast.success("已加入发送队列", { description: "全部录用" })
        return
      }
      void doSend(text)
    },
    [curatorConversationId, isBusy, enqueue, doSend]
  )

  const handleSendMessage = useCallback(
    async (message: PromptInputMessage | string) => {
      const messageText =
        (typeof message === "string" ? message : message.text)?.trim() ?? ""
      const hasFiles =
        typeof message !== "string" && (message.files?.length ?? 0) > 0
      if (!(messageText || hasFiles)) return
      if (isBusy || !curatorConversationId) {
        enqueue({
          id: `pending-${Date.now()}`,
          text: messageText,
          command: command ? { id: command.id, title: command.title } : null,
          mentions: mentions.length > 0 ? [...mentions] : undefined,
        })
        setInputValue("")
        return
      }
      setInputValue("")
      await doSend(message)
    },
    [isBusy, enqueue, command, mentions, doSend, curatorConversationId]
  )

  const contacts = useChatStore((s) => s.contacts)
  const resolvedContact = useMemo(() => {
    if (contact) return contact
    return contacts.find((c) => c.type === "curator")
  }, [contact, contacts])
  const mentionCandidates = useMemo(() => {
    return contacts
      .filter((c) => c.type === "employee" && c.employee)
      .map((c) => ({
        id: c.employee!.id,
        name: c.employee!.name,
        avatar: c.employee!.avatar,
        role: c.employee!.role,
      }))
  }, [contacts])
  const { data: executions = [] } =
    useCuratorTaskExecutions(curatorConversationId)

  const executionSummaryIds = useMemo(() => {
    const map = buildExecutionSummaryTsMap(storedMessages)
    return new Set(map.keys())
  }, [storedMessages])

  /* ── Build unified timeline ── */
  const timeline: TimelineEntry[] = useMemo(() => {
    const entries: TimelineEntry[] = []
    const summaryTsByExecId = buildExecutionSummaryTsMap(storedMessages)

    const maxExecutionTs = getMaxExecutionTimelineTs(executions)

    let lastRealTsIndex = -1
    for (let i = 0; i < displayMessages.length; i++) {
      if (getMsgTs(displayMessages[i], storedMessages) > 0) {
        lastRealTsIndex = i
      }
    }

    // 无时间戳（如 useChat 客户端 id 尚未与 DB 对齐）时按展示顺序递推 ts，
    // 避免 refetch 后 resume assistant 的真实 created_at 把 user 行排到其下方。
    // 尾部 live 消息须压过任务卡片的 ended_at，否则新对话会排在执行卡片上方。
    let lastKnownTs = 0
    for (let i = 0; i < displayMessages.length; i++) {
      const msg = displayMessages[i]
      let ts = getMsgTs(msg, storedMessages)
      if (ts === 0) {
        const bump = lastKnownTs + 1000
        ts =
          i > lastRealTsIndex
            ? Math.max(bump, maxExecutionTs + 1000)
            : bump
      } else if (ts <= lastKnownTs) {
        ts = lastKnownTs + 1000
      }
      lastKnownTs = ts
      entries.push({ kind: "message", data: msg, ts })
    }

    for (const exec of executions) {
      if (!TERMINAL_EXECUTION_STATUSES.has(exec.run_status)) continue

      const tsRaw = getExecutionTimelineTs(exec)
      if (tsRaw == null) continue

      const summaryTs = summaryTsByExecId.get(exec.id)
      const ts =
        summaryTs != null ? Math.max(tsRaw, summaryTs + 1000) : tsRaw

      entries.push({
        kind: "execution",
        data: exec,
        ts,
      })
    }

    entries.sort((a, b) => a.ts - b.ts)
    return entries
  }, [displayMessages, executions, storedMessages])

  const contactDisplayName = resolvedContact?.curator?.name ?? "总管助手"

  const isCompact = size === "compact"
  const layout = getCuratorLayout(size)

  const curatorRecruitmentValue = useMemo(
    () => ({
      onHire: handleRecruitmentHire,
      onHireAll: handleRecruitmentHireAll,
      hireDisabled: !curatorConversationId,
    }),
    [handleRecruitmentHire, handleRecruitmentHireAll, curatorConversationId]
  )

  const curatorFileValue = useMemo(
    () => ({
      conversationId: curatorConversationId,
      onOpenFile: (path: string) => {
        if (onOpenResourceFile) {
          onOpenResourceFile(path)
        } else {
          openResource(path)
        }
      },
    }),
    [curatorConversationId, onOpenResourceFile, openResource]
  )

  const showEmptyWelcome =
    !isMessagesLoading &&
    timeline.length === 0 &&
    status !== "submitted" &&
    status !== "streaming"

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col bg-background",
        !isCompact ? "flex-1" : "h-full",
        className
      )}
      {...props}
    >
      {isCompact ? (
        <CuratorCompactToolbar
          contact={resolvedContact}
          conversationId={curatorConversationId}
          displayName={contactDisplayName}
          conversationTitle={conversationTitle}
          onReset={() => setShowResetDialog(true)}
          onOpenConversations={onOpenConversations}
          onNewConversation={onNewConversation}
          resourcesOpen={resourcesOpen}
          onToggleResources={onToggleResources}
        />
      ) : (
        <CuratorChatHeader
          contact={resolvedContact}
          conversationId={curatorConversationId}
          title={conversationTitle}
          onReset={() => setShowResetDialog(true)}
          onOpenContacts={onOpenContacts}
          onOpenConversations={onOpenConversations}
          onNewConversation={onNewConversation}
        />
      )}

      <CuratorFileProvider value={curatorFileValue}>
        <CuratorRecruitmentProvider value={curatorRecruitmentValue}>
          <CuratorPlanFeedbackProvider value={curatorPlanFeedbackValue}>
          <ConversationUI className="min-h-0 flex-1">
            <ConversationContent className={layout.conversationContent}>
              {showEmptyWelcome && (
                <CuratorEmptyWelcome
                  contact={resolvedContact}
                  displayName={contactDisplayName}
                  onSuggestionSelect={handleGuidanceSelect}
                  suggestionsDisabled={!curatorConversationId}
                  size={size}
                />
              )}

              {timeline.map((entry) => {
                if (entry.kind === "execution") {
                  const exec = entry.data
                  const hasSummary = executionSummaryIds.has(exec.id)
                  const employeeContact = contacts.find(
                    (c) =>
                      c.type === "employee" &&
                      c.employee?.id === String(exec.employee_id)
                  )

                  if (hasSummary) {
                    return (
                      <div
                        key={`exec-${exec.id}`}
                        className={cn("w-full", layout.message)}
                      >
                        <ExecutionReportCard
                          compact
                          execution={exec}
                          curatorContactId={curatorContactId}
                          curatorConversationId={curatorConversationId}
                        />
                      </div>
                    )
                  }

                  return (
                    <Message
                      key={`exec-${exec.id}`}
                      from="assistant"
                      className={layout.message}
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <EmployeeContactAvatar
                          name={exec.employee_name || String(exec.employee_id)}
                          avatar={employeeContact?.employee?.avatar}
                          avatarClassName="size-6"
                          fallbackClassName="text-[10px]"
                        />
                        <span className="text-xs text-muted-foreground">
                          {exec.employee_name || String(exec.employee_id)}
                        </span>
                        <span className="text-[10px] text-muted-foreground/60">
                          {formatTime(entry.ts)}
                        </span>
                      </div>
                      <MessageContent className="w-auto">
                        <ExecutionReportCard
                          execution={exec}
                          curatorContactId={curatorContactId}
                          curatorConversationId={curatorConversationId}
                        />
                      </MessageContent>
                    </Message>
                  )
                }

                /* message */
                const message = entry.data
                const isLastAssistantMessage =
                  message.role === "assistant" &&
                  message.id === lastAssistantMessageId
                const includeFileChanges = shouldIncludeFileChangesForMessage(
                  message,
                  displayMessages,
                  hasCurrentTurnEnded
                )
                
                return (
                  <CuratorMessageItem
                    key={message.id}
                    message={message}
                    isLastAssistantMessage={isLastAssistantMessage}
                    hasCurrentTurnEnded={hasCurrentTurnEnded}
                    includeFileChanges={includeFileChanges}
                    layout={layout}
                    resolvedContact={resolvedContact}
                    contactDisplayName={contactDisplayName}
                    ts={entry.ts}
                    session={session}
                    curatorConversationId={curatorConversationId}
                    onSendUserMessage={sendFeedbackMessage}
                  />
                )
              })}

              {showStreamingIndicator && (
                <Message
                  from="assistant"
                  className={cn("-mt-4", layout.message)}
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
          </ConversationUI>
          </CuratorPlanFeedbackProvider>
        </CuratorRecruitmentProvider>
      </CuratorFileProvider>

      <div className={layout.footer}>
        {curatorConversationId ? (
          <ChatComposerArea
            messages={messages}
            conversationId={curatorConversationId}
            onHitlApproved={session.onHitlApproved}
            activeHitl={session.activeHitl}
            inputValue={inputValue}
            onInputChange={handleTextChange}
            onSend={handleSendMessage}
            onStop={handleStop}
            status={chatStatus}
            submitDisabled={
              !isBusy && !inputValue.trim()
            }
            size="compact"
            placeholder={<CuratorRotatingPlaceholder />}
            className="w-full"
            slashCommands={[]}
            mentionCandidates={mentionCandidates}
            onAttachmentsChange={handleAttachmentsChange}
            pendingMessages={pendingQueue}
            onPendingRemove={pendingRemove}
            onPendingSendNow={pendingSendNow}
            onPendingMoveUp={pendingMoveUp}
            onPendingMoveDown={pendingMoveDown}
            error={error}
            pendingQueueClassName="mx-auto w-[98%]"
          />
        ) : null}
      </div>

      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清空会话</AlertDialogTitle>
            <AlertDialogDescription>
              确定要清空总管助手的会话记录吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2 px-1">
            <Checkbox
              id="clear-task-logs"
              checked={clearTaskLogs}
              onCheckedChange={(checked) => setClearTaskLogs(checked === true)}
            />
            <label
              htmlFor="clear-task-logs"
              className="cursor-pointer text-xs text-muted-foreground select-none"
            >
              同时清空员工执行日志
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset}>确定</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
