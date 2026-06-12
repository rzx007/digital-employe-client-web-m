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
import {
  getCopyableMessageText,
  mapStoredMessagesToUIMessages,
} from "@/lib/chat/message-utils"
import { shouldIncludeFileChangesForMessage } from "@/lib/chat/file-change-utils"
import { useConversationSession } from "@/hooks/use-conversation-session"
import { getContactId } from "@/lib/chat/contact-utils"
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
import { prepareVoiceMeta } from "@/lib/voice/prepare-voice-meta"
import { getVoiceMeta } from "@/lib/voice/voice-meta"
import { VoiceMessageCapsule } from "@/components/chat/messages/voice-message-capsule"
import type { VoiceMessageMeta } from "@/types/chat"
import { shouldRenameCuratorConversationOnFirstMessage } from "@/lib/chat/curator-conversation-actions"
import { applySemanticConversationTitle } from "@/lib/chat/conversation-title"
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
import { ChatStreamingIndicator } from "../panel/chat-streaming-indicator"
import { CuratorRotatingPlaceholder } from "./curator-rotating-placeholder"
import { CuratorEmptyWelcome } from "./curator-empty-welcome"
import { CuratorFileProvider } from "./curator-file-provider"
import { CuratorRecruitmentProvider } from "./curator-recruitment-provider"
import { CuratorPlanFeedbackProvider } from "./curator-plan-feedback-context"
import { useArtifactStore } from "@/stores/artifact-store"
import { EmployeeContactAvatar } from "../contacts/contact-avatars"
import { getElapsedMsFromMeta } from "../shared/chat-view-shared"
import {
  buildCuratorTimeline,
  type TimelineEntry,
} from "./build-curator-timeline"
import { MessageAssistantActions } from "../messages/message-assistant-actions"
import { MessageCopyAction } from "../messages/message-copy-action"
import { format } from "date-fns"
import { zhCN } from "date-fns/locale"
import { curatorUnreadKey } from "@/lib/constants"
import {
  buildRecruitmentHireAllOutbound,
  buildRecruitmentHireOutbound,
  type RecruitmentCandidateItem,
} from "@/lib/chat/recruitment-tool-payload"
import {
  toolUiActionMetadata,
  type ToolUiActionOutbound,
} from "@/lib/chat/tool-ui-action"
import { chatKeys } from "@/lib/query-keys/chat"
import { useConversationStatusStore } from "@/stores/conversation-status-store"
import {
  prepareDisplayMessages,
  resolveHitlApproveMessageId,
} from "@/lib/chat/hitl"
import { pickMessageDisplaySource } from "@/lib/chat/pick-message-display-source"
import {
  isBenignStreamAbortError,
  isStreamDisconnectedError,
} from "@/lib/chat/stream-abort"

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
  const voiceMeta =
    message.role === "user"
      ? getVoiceMeta(
          (message as { metadata?: Record<string, unknown> }).metadata
        )
      : null
  const hitlApproveMessageId = resolveHitlApproveMessageId(
    message,
    session.activeHitl
  )
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
    <Message from={message.role} className={cn("group", layout.message)}>
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
      {voiceMeta && curatorConversationId != null ? (
        <VoiceMessageCapsule
          messageId={message.id}
          conversationId={curatorConversationId}
          meta={voiceMeta}
          transcript={copyText}
        />
      ) : (
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
      )}
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
  const onRetryResumeRef = useRef<() => boolean>(() => false)

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
      // 主动 abort 或 SSE 在 turn 结束前断开 → resume 续流，不向用户报错。
      // 总管同样跑长编排 turn，SSE 会被中间层掐断，需与执行会话一致地自动续流。
      if (
        isBenignStreamAbortError(chatError) ||
        isStreamDisconnectedError(chatError)
      ) {
        onRetryResumeRef.current()
        return
      }
      toast.error("发送失败", {
        description: chatError?.message || "请稍后重试",
      })
    },
  })

  const session = useConversationSession({
    conversationId: curatorConversationId,
    contactId: getContactId(contact),
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
    onRetryResumeRef.current = session.retryResumeIfNeeded
  }, [session.onStreamFinish, session.retryResumeIfNeeded])

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

  const prevCuratorConversationIdRef = useRef(curatorConversationId)

  useEffect(() => {
    if (prevCuratorConversationIdRef.current !== curatorConversationId) {
      chatTransport.cancelReconnect()
      prevCuratorConversationIdRef.current = curatorConversationId
    }
  }, [curatorConversationId])

  const displayError =
    error &&
    !isBenignStreamAbortError(error) &&
    !isStreamDisconnectedError(error)
      ? error
      : undefined

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
    const filtered = source.filter((msg) => {
      const meta = (msg as unknown as { metadata?: unknown }).metadata
      if (!meta || typeof meta !== "object") return true
      return (
        (meta as Record<string, unknown>).source !==
        "orchestrator_execution_summary"
      )
    })
    return prepareDisplayMessages(filtered)
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

      const voicePayload =
        typeof message === "string" ? undefined : message.voice

      let voiceMeta: VoiceMessageMeta | undefined
      if (voicePayload) {
        try {
          voiceMeta = await prepareVoiceMeta(curatorConversationId, voicePayload)
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "语音上传失败")
          return
        }
      }

      const pendingMeta = {
        command: command ? { id: command.id, title: command.title } : undefined,
        mentions: mentions.length > 0 ? mentions : undefined,
        files: filesMeta,
        voice: voiceMeta,
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

        // 注：技能"调用"以对话中真正执行为准（在 useClassifiedMessageBlocks 里
        // 依据工具读取 /skills/<名>/ 检测并上报），此处的"选中发送"不计为 invoke。

        if (
          shouldUpdateTitle &&
          curatorContactId &&
          contact?.type === "curator"
        ) {
          const contactId = getContactId(contact) ?? String(curatorContactId)
          void applySemanticConversationTitle({
            conversationId: curatorConversationId,
            messageText,
            contactId,
            updateTitle: updateTitleMutation.mutateAsync,
            onError: () => {
              toast.error("更新会话标题失败")
            },
          })
        }
      } catch (sendError) {
        const m = sendError instanceof Error ? sendError.message : ""
        const isAbort =
          (sendError instanceof Error && sendError.name === "AbortError") ||
          /abort|aborted|signal is aborted|no response/i.test(m)
        if (!isAbort) {
          toast.error("发送失败", {
            description: m || "请稍后重试",
          })
        }
      }
    },
    [
      curatorConversationId,
      sendMessage,
      command,
      mentions,
      session,
      conversationTitle,
      displayMessages.length,
      curatorContactId,
      contact,
      updateTitleMutation,
    ]
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

  const sendToolUiAction = useCallback(
    async (outbound: ToolUiActionOutbound) => {
      const agentText = outbound.agentText.trim()
      if (!agentText || !curatorConversationId) {
        throw new Error("会话未就绪，无法发送反馈")
      }

      if (isBusy) {
        await handleStop()
        await waitForChatReady()
      }

      const meta = toolUiActionMetadata(outbound)
      session.prepareOutboundMessage()
      await sendMessage(
        { text: agentText, metadata: meta },
        {
          body: {
            conversationId: curatorConversationId,
            skill: "",
            metadata: meta,
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
    () => ({ sendPlanFeedback: sendToolUiAction }),
    [sendToolUiAction]
  )

  const handleRecruitmentHire = useCallback(
    (candidate: RecruitmentCandidateItem) => {
      const outbound = buildRecruitmentHireOutbound(candidate)
      if (!curatorConversationId) {
        toast.error("会话未就绪，请稍后再试")
        return
      }
      if (isBusy) {
        enqueue({
          id: `pending-hire-${Date.now()}`,
          text: outbound.agentText,
          command: null,
        })
        toast.success("已加入发送队列", {
          description: outbound.displayText,
        })
        return
      }
      void sendToolUiAction(outbound)
    },
    [curatorConversationId, isBusy, enqueue, sendToolUiAction]
  )

  const handleRecruitmentHireAll = useCallback(
    (candidates: RecruitmentCandidateItem[]) => {
      const outbound = buildRecruitmentHireAllOutbound(candidates)
      if (!curatorConversationId) {
        toast.error("会话未就绪，请稍后再试")
        return
      }
      if (isBusy) {
        enqueue({
          id: `pending-hire-all-${Date.now()}`,
          text: outbound.agentText,
          command: null,
        })
        toast.success("已加入发送队列", {
          description: outbound.displayText,
        })
        return
      }
      void sendToolUiAction(outbound)
    },
    [curatorConversationId, isBusy, enqueue, sendToolUiAction]
  )

  const handleSendMessage = useCallback(
    async (message: PromptInputMessage | string) => {
      const messageText =
        (typeof message === "string" ? message : message.text)?.trim() ?? ""
      const hasFiles =
        typeof message !== "string" && (message.files?.length ?? 0) > 0
      if (!(messageText || hasFiles)) return
      const voicePayload =
        typeof message === "string" ? undefined : message.voice
      // 语音不进 pending 队列（队列项不携带 voice 载荷会静默降级为纯文本），
      // 且 useChat 客户端是单流模型：busy 时先停流再发（对齐 sendToolUiAction 先例）。
      if ((isBusy || !curatorConversationId) && !voicePayload) {
        enqueue({
          id: `pending-${Date.now()}`,
          text: messageText,
          command: command ? { id: command.id, title: command.title } : null,
          mentions: mentions.length > 0 ? [...mentions] : undefined,
        })
        setInputValue("")
        return
      }
      if (isBusy && voicePayload) {
        await handleStop()
        await waitForChatReady()
      }
      if (!voicePayload) {
        setInputValue("")
      }
      await doSend(message)
    },
    [
      isBusy,
      enqueue,
      command,
      mentions,
      doSend,
      curatorConversationId,
      handleStop,
      waitForChatReady,
    ]
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
  const { data: executions = [] } = useCuratorTaskExecutions(
    curatorConversationId
  )

  // 摘要消息已在 UI 层隐藏，执行卡片始终用 full 模式（带状态印章、输出预览、星级、跳转）
  const executionSummaryIds = useMemo(() => new Set<number>(), [])

  /* ── Build unified timeline ── */
  const timeline: TimelineEntry[] = useMemo(
    () => buildCuratorTimeline(displayMessages, executions, storedMessages),
    [displayMessages, executions, storedMessages]
  )

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
                            name={
                              exec.employee_name || String(exec.employee_id)
                            }
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
                    />
                  )
                })}

                {showStreamingIndicator && (
                  <ChatStreamingIndicator
                    status={status}
                    messages={messages}
                    className={cn("-mt-4", layout.message)}
                  />
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
            submitDisabled={!isBusy && !inputValue.trim()}
            showVoiceInput
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
            error={displayError}
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
