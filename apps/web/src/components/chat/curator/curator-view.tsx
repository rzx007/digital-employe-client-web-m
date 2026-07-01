import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  type ComponentProps,
} from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { cn } from "@workspace/ui/lib/utils"
import { useChat } from "@ai-sdk/react"
import type { UIMessage } from "ai"
import type { PromptInputMessage } from "@workspace/ui/components/ai-elements/prompt-input"
import type { PromptChangeEvent } from "@/components/lexical-editor/prompt-input-textarea"
import type { PromptComposerHandle } from "@/components/lexical-editor/prompt-input-textarea"
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
import { CuratorTurnDeliverables } from "./curator-turn-deliverables"
import { useConversationSession } from "@/hooks/use-conversation-session"
import { getContactId } from "@/lib/chat/contact-utils"
import { useInvalidateContactsOnTeamChanges } from "@/hooks/use-invalidate-contacts-on-team-changes"
import { useSyncPendingFromComposer } from "@/hooks/use-sync-pending-from-composer"
import {
  useMessagesQuery,
  useUpdateConversationTitleMutation,
} from "@/hooks/use-chat-queries"
import { usePendingMessages } from "@/hooks/use-pending-messages"
import { useSyncConversationSubtasks } from "@/hooks/use-conversation-subtasks"
import { useChatStore } from "@/stores/chat-store"
import { getLastAssistantMessage } from "@/lib/chat/message-query-cache"
import {
  useCuratorTaskExecutions,
  useCancelTaskExecution,
} from "@/hooks/use-schedule-monitor-queries"
import { ACTIVE_TASK_RUN_STATUSES } from "@/types/schedule-monitor"

import { fetchOrchestratorSkills } from "@/api/orchestrator"
import {
  buildCuratorSlashCommands,
  resolveCuratorSend,
} from "./curator-slash-commands"
import { cancelConversationStream } from "@/api/chat"
import { prepareVoiceMeta } from "@/lib/voice/prepare-voice-meta"
import { getVoiceMeta } from "@/lib/voice/voice-meta"
import { VoiceMessageCapsule } from "@/components/chat/messages/voice-message-capsule"
import type { VoiceMessageMeta } from "@/types/chat"
import { shouldRenameCuratorConversationOnFirstMessage } from "@/lib/chat/curator-conversation-actions"
import { applySemanticConversationTitle } from "@/lib/chat/conversation-title"
import { toast } from "sonner"
import { chatTransport, type ChatViewContact } from "../shared/chat-view-shared"
import { CuratorChatHeader } from "../contacts/curator-chat-header"
import { CuratorCompactToolbar } from "./curator-compact-toolbar"
import { getCuratorLayout } from "./curator-layout"

import { ChatComposerArea } from "../panel/chat-composer-area"
import { ChatStreamingIndicator } from "../panel/chat-streaming-indicator"
import { CuratorRotatingPlaceholder } from "./curator-rotating-placeholder"
import { CuratorEmptyWelcome } from "./curator-empty-welcome"
import { CuratorFileProvider } from "./curator-file-provider"
import { CuratorRecruitmentProvider } from "./curator-recruitment-provider"
import { CuratorPlanFeedbackProvider } from "./curator-plan-feedback-context"
import { TasksIndicator } from "./tasks-indicator"
import { useArtifactStore } from "@/stores/artifact-store"
import { EmployeeContactAvatar } from "../contacts/contact-avatars"
import { UserAvatar } from "@/components/user-avatar"
import { useAuthStore } from "@/stores/auth-store"
import { getChannelBadge } from "@/lib/chat/assistant-stream-state"
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
  sessionFlags,
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
  sessionFlags?: string | null
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

  const user = useAuthStore((s) => s.user)
  const userName = user?.name || "我"
  const channelBadge =
    message.role === "user"
      ? getChannelBadge(
          (message as { metadata?: Record<string, unknown> }).metadata
        )
      : null

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
  const isStreamingEmptyShell =
    message.role === "assistant" &&
    isLastAssistantMessage &&
    !hasCurrentTurnEnded &&
    classifiedBlocks.length === 0
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
      {message.role === "user" && channelBadge && (
        <div className="mb-2 flex items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground">
            {channelBadge.name}
          </span>
          <div className="size-6 shrink-0 overflow-hidden rounded">
            <img
              src={channelBadge.logo}
              alt={channelBadge.name}
              className="size-full object-cover"
            />
          </div>
        </div>
      )}
      {message.role === "user" && !channelBadge && (
        <div className="mb-2 flex items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground">{userName}</span>
          <div className="size-6 shrink-0 overflow-hidden rounded">
            <UserAvatar
              userId={user?.id}
              alt={userName}
              className="size-full object-cover"
            />
          </div>
        </div>
      )}
      {voiceMeta && curatorConversationId != null ? (
        <VoiceMessageCapsule
          messageId={message.id}
          conversationId={curatorConversationId}
          meta={voiceMeta}
          transcript={copyText}
        />
      ) : isStreamingEmptyShell ? null : (
        <MessageContent className="w-auto">
          <div className="space-y-3">
            {classifiedBlocks.length > 0 ? (
              classifiedBlocks.map((block) => (
                <BlockRenderer key={block.key} block={block} ctx={ctx} />
              ))
            ) : message.role === "assistant" ? (
              <MessageResponse />
            ) : null}
            {/* 团队交付物紧贴在本轮最后一条总管消息的内容末尾（与其自身文件卡同区） */}
            {isLastAssistantMessage &&
            hasCurrentTurnEnded &&
            message.role === "assistant" &&
            curatorConversationId != null ? (
              <CuratorTurnDeliverables
                conversationId={curatorConversationId}
                sessionFlags={sessionFlags}
              />
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
  sessionFlags,
  title: conversationTitle,
  size = "default",
  resourcesOpen,
  onToggleResources,
  onToggleTasks,
  onOpenResourceFile,
  onOpenContacts,
  onOpenConversations,
  onNewConversation,
  isCreatingConversation,
  className,
  ...props
}: ComponentProps<"div"> & {
  contact?: ChatViewContact
  conversationId: string | number
  sessionFlags?: string | null
  title?: string
  size?: "default" | "compact"
  /** compact 工作台：由 WorkbenchContentSplit 控制资源分栏 */
  resourcesOpen?: boolean
  onToggleResources?: () => void
  /** compact 工作台：由 WorkbenchContentSplit 在打开合并任务面板时收起资源分栏 */
  onToggleTasks?: () => void
  /** 工作台：打开资源面板并选中文件 */
  onOpenResourceFile?: (path: string) => void
  onOpenContacts?: () => void
  onOpenConversations?: () => void
  onNewConversation?: () => void
  isCreatingConversation?: boolean
}) {
  const [inputValue, setInputValue] = useState("")
  const [command, setCommand] = useState<{ id: string; title: string } | null>(
    null
  )
  const [mentions, setMentions] = useState<Array<{ id: string; name: string }>>(
    []
  )
  const composerRef = useRef<PromptComposerHandle>(null)
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

  // 把总管会话里派发的并行子任务（task 工具）同步进 tasks-panel-store，
  // 让挂在 chat 布局右侧的子任务面板（与普通员工会话同源）能展示。
  useSyncConversationSubtasks(messages)

  useInvalidateContactsOnTeamChanges(messages, status, queryClient)

  useEffect(() => {
    onStreamFinishRef.current = session.onStreamFinish
    onRetryResumeRef.current = session.retryResumeIfNeeded
  }, [session.onStreamFinish, session.retryResumeIfNeeded])

  // 总管派发的员工任务执行(后台异步跑)。在 handleStop 之前定义，供「点停止=中止所有任务」。
  const { data: curatorExecutions = [] } =
    useCuratorTaskExecutions(curatorConversationId)
  const runningExecutions = curatorExecutions.filter((e) =>
    ACTIVE_TASK_RUN_STATUSES.has(e.run_status)
  )
  const tasksRunning = runningExecutions.length > 0
  const cancelExec = useCancelTaskExecution(curatorConversationId)

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
    // 中止所有在跑的员工任务(点停止=真的停掉编排，依赖的后续任务后端会一并跳过)。
    if (runningExecutions.length > 0) {
      const results = await Promise.allSettled(
        runningExecutions.map((e) => cancelExec.mutateAsync(e.id))
      )
      if (results.some((r) => r.status === "rejected")) {
        toast.error("部分任务中止失败，请稍后重试")
      } else {
        toast.success(`已中止 ${runningExecutions.length} 个任务`)
      }
    }
    session.onStreamStopped()
  }, [stop, curatorConversationId, session, runningExecutions, cancelExec])

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

  const handleTextChange = useCallback((event: PromptChangeEvent) => {
    setCommand(event.command)
    setMentions(event.mentions)
    setInputValue(event.value)
  }, [])

  // 后端仍在跑(DB 末条 assistant streamState=streaming)但本地 SSE 假结束(status=ready)时
  // 也算忙——发送走排队、显忙、不抢占在跑的流（与主对话 ConversationChatView 同源修复）。
  const backendStreaming =
    getLastAssistantMessage(storedMessages)?.streamState === "streaming"
  // 忙 = 总管自身的流在跑 / 后端假结束仍在跑 / 员工任务在后台跑。
  const isBusy =
    status === "submitted" ||
    status === "streaming" ||
    backendStreaming ||
    tasksRunning
  const chatStatus: typeof status =
    status === "ready" && isBusy ? "submitted" : status

  const displayMessages = useMemo(() => {
    const source = pickMessageDisplaySource(
      messages,
      initialMessages,
      chatStatus
    )
    const filtered = source.filter((msg) => {
      const meta = (msg as unknown as { metadata?: unknown }).metadata
      if (!meta || typeof meta !== "object") return true
      return (
        (meta as Record<string, unknown>).source !==
        "orchestrator_execution_summary"
      )
    })
    return prepareDisplayMessages(filtered)
  }, [messages, initialMessages, chatStatus])

  const lastAssistantMessageId = useMemo(() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      if (displayMessages[i].role === "assistant") return displayMessages[i].id
    }
    return null
  }, [displayMessages])

  const hasCurrentTurnEnded =
    (status === "ready" || status === "error" || !!error) && !backendStreaming
  const showStreamingIndicator =
    !isMessagesLoading &&
    (status === "submitted" || status === "streaming" || backendStreaming) &&
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

  const { data: orchestratorSkills } = useQuery({
    queryKey: chatKeys.orchestratorSkills(),
    queryFn: fetchOrchestratorSkills,
    staleTime: 5 * 60 * 1000,
  })
  const curatorSlashCommands = useMemo(
    () => buildCuratorSlashCommands(orchestratorSkills ?? []),
    [orchestratorSkills]
  )

  const doSend = useCallback(
    async (message: PromptInputMessage | string) => {
      const messageText =
        (typeof message === "string" ? message : message.text)?.trim() ?? ""
      const selectedCommandItem = command
        ? curatorSlashCommands.find((c) => c.id === command.id)
        : undefined
      const { text: outboundText, skill: skillParam } = resolveCuratorSend(
        selectedCommandItem,
        messageText
      )
      if (!outboundText || !curatorConversationId) return

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
          { text: outboundText, metadata: pendingMeta },
          {
            body: {
              conversationId: curatorConversationId,
              skill: skillParam,
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
      curatorSlashCommands,
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

  const handleMentionEmployee = useCallback(
    (employee: { id: string; name: string }) => {
      if (isBusy || !curatorConversationId) return
      composerRef.current?.insertMention(employee.id, employee.name)
      composerRef.current?.focus()
    },
    [isBusy, curatorConversationId]
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
  } = usePendingMessages({
    status,
    onSend: doSend,
    onStop: handleStop,
    backendBusy: backendStreaming || tasksRunning,
  })

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
      if (!(messageText || hasFiles || command)) return
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
  /* ── Build unified timeline ── */
  const timeline: TimelineEntry[] = useMemo(
    () => buildCuratorTimeline(displayMessages, storedMessages),
    [displayMessages, storedMessages]
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
          onOpenConversations={onOpenConversations}
          onNewConversation={onNewConversation}
          isCreatingConversation={isCreatingConversation}
          resourcesOpen={resourcesOpen}
          onToggleResources={onToggleResources}
        />
      ) : (
        <CuratorChatHeader
          contact={resolvedContact}
          conversationId={curatorConversationId}
          title={conversationTitle}
          onOpenContacts={onOpenContacts}
          onOpenConversations={onOpenConversations}
          onNewConversation={onNewConversation}
          isCreatingConversation={isCreatingConversation}
        />
      )}

      <CuratorFileProvider value={curatorFileValue}>
        <CuratorRecruitmentProvider value={curatorRecruitmentValue}>
          <CuratorPlanFeedbackProvider value={curatorPlanFeedbackValue}>
            <ConversationUI className="min-h-0 flex-1">
              <ConversationContent className={layout.conversationContent}>
                {showEmptyWelcome && (
                  <CuratorEmptyWelcome
                    displayName={contactDisplayName}
                    onSuggestionSelect={handleGuidanceSelect}
                    onMentionEmployee={handleMentionEmployee}
                    suggestionsDisabled={isBusy || !curatorConversationId}
                    size={size}
                  />
                )}

                {timeline.map((entry) => {
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
                      sessionFlags={sessionFlags}
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

      <TasksIndicator
        conversationId={curatorConversationId}
        onOpen={onToggleTasks}
        className="mb-2"
      />

      <div className={layout.footer}>
        {curatorConversationId ? (
          <ChatComposerArea
            composerRef={composerRef}
            messages={messages}
            conversationId={curatorConversationId}
            onHitlApproved={session.onHitlApproved}
            activeHitl={session.activeHitl}
            inputValue={inputValue}
            onInputChange={handleTextChange}
            onSend={handleSendMessage}
            onStop={handleStop}
            status={chatStatus}
            submitDisabled={!isBusy && !inputValue.trim() && !command}
            showVoiceInput
            size="compact"
            placeholder={<CuratorRotatingPlaceholder />}
            className="w-full"
            slashCommands={curatorSlashCommands}
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
    </div>
  )
}
