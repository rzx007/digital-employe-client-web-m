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
  classifyMessageParts,
  getCopyableMessageText,
  mapStoredMessagesToUIMessages,
} from "@/lib/chat/message-utils"
import {
  useMessagesQuery,
  useCuratorConversationQuery,
  useResetCuratorConversation,
} from "@/hooks/use-chat-queries"
import { usePendingMessages } from "@/hooks/use-pending-messages"
import { useChatStore } from "@/stores/chat-store"
import { useAllTaskExecutions } from "@/hooks/use-schedule-monitor-queries"
import { cancelConversationStream } from "@/api/conversation"
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
import { ExecutionReportCard } from "../message-blocks/execution-report-card"
import { ChatPromptInput } from "@/components/chat-prompt-input"
import { CuratorRotatingPlaceholder } from "./curator-rotating-placeholder"
import { PendingMessageQueue } from "../panel/pending-message-queue"
import { EmployeeContactAvatar } from "../contacts/contact-avatars"
import {
  getElapsedMsFromMeta,
  getMessageCreatedAtMs,
  getMessageMeta,
} from "../shared/chat-view-shared"
import { MessageAssistantActions } from "../messages/message-assistant-actions"
import { MessageCopyAction } from "../messages/message-copy-action"
import { RenderClassifiedBlocks } from "../messages/chat-message-item"
import { computeToolAutoCollapseMap } from "@/lib/chat/tool-collapse-policy"
import { format } from "date-fns"
import { zhCN } from "date-fns/locale"
import type { TaskExecution } from "@/types/schedule-monitor"
import { curatorUnreadKey } from "@/lib/constants"
import { chatKeys } from "@/lib/query-keys/chat"
import { useConversationStatusStore } from "@/stores/conversation-status-store"

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

function formatTime(ts: number): string {
  return format(new Date(ts), "HH:mm", { locale: zhCN })
}

export function CuratorView({
  contact,
  size = "default",
  className,
  ...props
}: ComponentProps<"div"> & {
  contact?: ChatViewContact
  size?: "default" | "compact"
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
  const [hasReceivedMessages, setHasReceivedMessages] = useState(false)

  const resetMutation = useResetCuratorConversation()
  const queryClient = useQueryClient()
  const { data: curatorConv, isLoading: curatorLoading } =
    useCuratorConversationQuery()
  const curatorConversationId = curatorConv?.id ?? null

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
    messages: initialMessages,
    transport: chatTransport,
    onFinish: () => {
      if (!curatorConversationId) return
      void queryClient.invalidateQueries({
        queryKey: chatKeys.messages(String(curatorConversationId)),
      })
    },
    onError: (chatError) => {
      toast.error("发送失败", {
        description: chatError.message || "请稍后重试",
      })
    },
  })

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
  }, [stop, curatorConversationId])

  // 组件卸载时停止对话
  useEffect(() => {
    return () => {
      console.log("🚀 ~ useEffect ~ 组件卸载时停止对话")
      stop()
    }
  }, [stop])

  const handleReset = useCallback(async () => {
    if (!curatorConversationId) return
    try {
      await resetMutation.mutateAsync({
        conversationId: curatorConversationId,
        clearTaskLogs,
      })
      queryClient.setQueryData(
        chatKeys.messages(String(curatorConversationId)),
        []
      )
      setMessages([])
      setHasReceivedMessages(false)
      setShowResetDialog(false)
      toast.success("会话已清空")
    } catch {
      toast.error("清空失败")
    }
  }, [
    curatorConversationId,
    clearTaskLogs,
    resetMutation,
    setMessages,
    queryClient,
  ])

  useEffect(() => {
    if (messages.length > 0 && !hasReceivedMessages) {
      setHasReceivedMessages(true)
    }
  }, [messages, hasReceivedMessages])

  useEffect(() => {
    if (!initialMessages.length || !curatorConversationId) return
    if (status === "streaming" || status === "submitted") return

    setMessages(initialMessages)
    const lastStored = storedMessages?.[storedMessages.length - 1]
    if (
      lastStored?.role === "assistant" &&
      lastStored.streamState === "streaming" &&
      (status === "ready" || status === "error")
    ) {
      const rafId = requestAnimationFrame(() => {
        if (status !== "ready" && status !== "error") return
        resumeStream()
      })
      return () => cancelAnimationFrame(rafId)
    }
    // status 是防护，不用加入依赖数组
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    curatorConversationId,
    initialMessages,
    setMessages,
    resumeStream,
    storedMessages,
  ])

  const handleTextChange = useCallback((event: PromptChangeEvent) => {
    setCommand(event.command)
    setMentions(event.mentions)
    setInputValue(event.value)
  }, [])

  const isBusy = status === "submitted" || status === "streaming"
  const chatStatus = status === "ready" && isBusy ? "submitted" : status

  const displayMessages = useMemo(
    () =>
      messages.length > 0 || hasReceivedMessages ? messages : initialMessages,
    [initialMessages, messages, hasReceivedMessages]
  )

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
      } catch (sendError) {
        toast.error("发送失败", {
          description:
            sendError instanceof Error ? sendError.message : "请稍后重试",
        })
      }
    },
    [curatorConversationId, sendMessage, command, mentions]
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

  const handleSendMessage = useCallback(
    async (message: PromptInputMessage) => {
      const messageText = message.text?.trim() ?? ""
      if (!(messageText || message.files?.length)) return
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
  const { data: executions = [] } = useAllTaskExecutions()

  /* ── Build unified timeline ── */
  const timeline: TimelineEntry[] = useMemo(() => {
    const entries: TimelineEntry[] = []

    // 保持无时间戳消息的相对顺序并与真实时间线一致
    const n = displayMessages.length
    let anchor = 0
    for (const msg of displayMessages) {
      const t = getMsgTs(msg, storedMessages)
      if (t > anchor) anchor = t
    }
    for (const exec of executions) {
      if (
        exec.run_status === "success" ||
        exec.run_status === "failed" ||
        exec.run_status === "timeout" ||
        exec.run_status === "cancelled"
      ) {
        const t = exec.ended_at
          ? new Date(exec.ended_at).getTime()
          : new Date(exec.started_at).getTime()
        if (t > anchor) anchor = t
      }
    }
    const pseudoNow = anchor + (n + 1) * 1000
    const fallbackBase = pseudoNow - n * 1000
    let fallbackIdx = 0

    for (const msg of displayMessages) {
      let ts = getMsgTs(msg, storedMessages)
      if (ts === 0) {
        ts = fallbackBase + fallbackIdx * 1000
        fallbackIdx++
      }
      entries.push({ kind: "message", data: msg, ts })
    }

    for (const exec of executions) {
      if (
        exec.run_status === "success" ||
        exec.run_status === "failed" ||
        exec.run_status === "timeout" ||
        exec.run_status === "cancelled"
      ) {
        entries.push({
          kind: "execution",
          data: exec,
          ts: exec.ended_at
            ? new Date(exec.ended_at).getTime()
            : new Date(exec.started_at).getTime(),
        })
      }
    }

    entries.sort((a, b) => a.ts - b.ts)
    return entries
  }, [displayMessages, executions, storedMessages])

  const isDraft = !curatorConversationId
  const contactDisplayName = resolvedContact?.curator?.name ?? "总管助手"

  const isCompact = size === "compact"

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col bg-background",
        !isCompact ? "flex-1" : "h-full",
        className
      )}
      {...props}
    >
      {!isCompact && (
        <CuratorChatHeader
          contact={contact}
          onReset={() => setShowResetDialog(true)}
        />
      )}

      <ConversationUI className="min-h-0 flex-1">
        <ConversationContent className="space-y-3">
          {curatorLoading && (
            <div className="flex items-center justify-center py-16">
              <Spinner className="size-5" />
            </div>
          )}

          {!curatorLoading && isDraft && timeline.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
              <p className="text-xs">
                在下方输入消息，自然语言下发任务给你的数字员工团队
              </p>
            </div>
          )}

          {timeline.map((entry) => {
            if (entry.kind === "execution") {
              const exec = entry.data
              const employeeContact = contacts.find(
                (c) =>
                  c.type === "employee" &&
                  c.employee?.id === String(exec.employee_id)
              )
              return (
                <Message
                  key={`exec-${exec.id}`}
                  from="assistant"
                  className="mx-auto max-w-4xl"
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
                    <ExecutionReportCard execution={exec} />
                  </MessageContent>
                </Message>
              )
            }

            /* message */
            const message = entry.data
            const isLastAssistantMessage =
              message.role === "assistant" &&
              message.id === lastAssistantMessageId
            const includeFileChanges =
              message.role === "assistant" &&
              (!isLastAssistantMessage || hasCurrentTurnEnded)
            const classifiedBlocks = classifyMessageParts(message, {
              includeFileChanges,
            })
            const toolAutoCollapseMap = computeToolAutoCollapseMap(
              classifiedBlocks,
              {
                isLastAssistantMessage,
                isTurnEnded: hasCurrentTurnEnded,
              }
            )
            const messageMeta = getMessageMeta(message)
            const commandMeta =
              messageMeta &&
                typeof messageMeta === "object" &&
                "command" in messageMeta &&
                messageMeta.command &&
                typeof messageMeta.command === "object"
                ? (messageMeta.command as { id?: string; title?: string })
                : null
            const mentionMeta =
              messageMeta &&
                typeof messageMeta === "object" &&
                "mentions" in messageMeta &&
                Array.isArray(messageMeta.mentions)
                ? (messageMeta.mentions as Array<{
                  id?: string
                  name?: string
                }>)
                : []
            const filesMeta =
              messageMeta &&
                typeof messageMeta === "object" &&
                "files" in messageMeta &&
                Array.isArray(messageMeta.files)
                ? (messageMeta.files as Array<{ name: string; path: string }>)
                : undefined
            const elapsedMs = getElapsedMsFromMeta(message)
            const copyText = getCopyableMessageText(message, {
              includeFileChanges,
            })
            return (
              <Message
                key={message.id}
                from={message.role}
                className={cn("group mx-auto max-w-4xl")}
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
                      {formatTime(entry.ts)}
                    </span>
                  </div>
                )}
                <MessageContent className="w-auto">
                  <div className="space-y-3">
                    {classifiedBlocks.length > 0 ? (
                      <RenderClassifiedBlocks
                        blocks={classifiedBlocks}
                        commandMeta={commandMeta}
                        mentionMeta={mentionMeta}
                        filesMeta={filesMeta}
                        messageId={message.id}
                        toolAutoCollapseMap={toolAutoCollapseMap}
                        isLastAssistantMessage={isLastAssistantMessage}
                        isTurnEnded={hasCurrentTurnEnded}
                      />
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
          })}

          {showStreamingIndicator && (
            <Message from="assistant" className="mx-auto -mt-4 max-w-4xl">
              <MessageContent className="rounded-lg bg-muted/40 px-3 py-2.5">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Spinner className="size-3.5" style={{ color: "#8B5CF6" }} />
                  <Shimmer className="text-xs">正在生成回复...</Shimmer>
                </div>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </ConversationUI>

      <div
        className={cn(
          "mx-auto w-full max-w-4xl border-none",
          isCompact ? "py-2" : "py-4"
        )}
      >
        {pendingQueue.length > 0 && (
          <div className="mx-auto w-[98%]">
            <PendingMessageQueue
              queue={pendingQueue}
              onRemove={pendingRemove}
              onSendNow={pendingSendNow}
              onMoveUp={pendingMoveUp}
              onMoveDown={pendingMoveDown}
            />
          </div>
        )}
        <ChatPromptInput
          value={inputValue}
          onChange={handleTextChange}
          onSubmit={handleSendMessage}
          onStop={handleStop}
          status={chatStatus}
          disabled={curatorLoading || (!isBusy && !inputValue.trim())}
          size="compact"
          placeholder={<CuratorRotatingPlaceholder />}
          className="w-full"
          slashCommands={[]}
          mentionCandidates={mentionCandidates}
          conversationId={curatorConversationId}
          onAttachmentsChange={handleAttachmentsChange}
        />
        {error && (
          <p className="mt-2 text-xs text-destructive">{error.message}</p>
        )}
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
