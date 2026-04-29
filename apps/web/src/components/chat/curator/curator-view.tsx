import * as React from "react"
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
import { mapStoredMessagesToUIMessages } from "@/lib/chat/message-utils"
import { classifyMessageParts } from "@/lib/chat/message-utils"
import { useMessagesQuery, useCuratorConversationQuery } from "@/hooks/use-chat-queries"
import { usePendingMessages } from "@/hooks/use-pending-messages"
import { useAllTaskExecutions } from "@/hooks/use-schedule-monitor-queries"
import { cancelConversationStream } from "@/api/conversation"
import { toast } from "sonner"
import { chatTransport, type ChatViewContact } from "../chat-view-shared"
import { CuratorChatHeader } from "../curator-chat-header"
import { ExecutionReportCard } from "../execution-report-card"
import { ChatPromptInput } from "@/components/chat-prompt-input"
import { PendingMessageQueue } from "../pending-message-queue"
import { EmployeeContactAvatar } from "../contact-avatars"
import {
  renderClassifiedBlocks,
  getMessageMeta,
} from "../chat-panel"
import { useEffect } from "react"
import { format } from "date-fns"
import { zhCN } from "date-fns/locale"
import type { TaskExecution } from "@/types/schedule-monitor"

type TimelineEntry =
  | { kind: "message"; data: UIMessage; ts: number }
  | { kind: "execution"; data: TaskExecution; ts: number }

function getMsgTs(msg: UIMessage, storedMessages: Array<{ id: string; metadata?: Record<string, any>; timestamp?: Date }>): number {
  const stored = storedMessages.find((m) => m.id === msg.id)
  const meta = stored?.metadata
  if (meta?.created_at) return new Date(meta.created_at).getTime()
  if (stored?.timestamp) return stored.timestamp.getTime()
  return 0
}

function formatTime(ts: number): string {
  return format(new Date(ts), "HH:mm", { locale: zhCN })
}

export function CuratorView({
  contact,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  contact?: ChatViewContact
}) {
  const [inputValue, setInputValue] = React.useState("")
  const [command, setCommand] = React.useState<{ id: string; title: string } | null>(null)
  const [mentions, setMentions] = React.useState<Array<{ id: string; name: string }>>([])

  const { data: curatorConv, isLoading: curatorLoading } = useCuratorConversationQuery()
  const curatorConversationId = curatorConv?.id ?? null

  const { data: storedMessages = [], isPending: isMessagesLoading } = useMessagesQuery(curatorConversationId)

  const initialMessages = React.useMemo(
    () => (storedMessages?.length ? mapStoredMessagesToUIMessages(storedMessages) : []),
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
    onFinish: () => { },
    onError: (chatError) => {
      toast.error("发送失败", { description: chatError.message || "请稍后重试" })
    },
  })

  const handleStop = React.useCallback(async () => {
    stop()
    if (curatorConversationId) {
      try { await cancelConversationStream(curatorConversationId) } catch { }
    }
  }, [stop, curatorConversationId])

  useEffect(() => {
    if (!initialMessages.length || !curatorConversationId) return
    setMessages(initialMessages)
    const lastStored = storedMessages?.[storedMessages.length - 1]
    if (lastStored?.role === "assistant" && lastStored.streamState === "streaming") {
      resumeStream()
    }
  }, [curatorConversationId, initialMessages, setMessages, resumeStream, storedMessages])

  const handleTextChange = React.useCallback((event: PromptChangeEvent) => {
    setCommand(event.command)
    setMentions(event.mentions)
    setInputValue(event.value)
  }, [])

  const isBusy = status === "submitted" || status === "streaming"
  const chatStatus = status === "ready" && isBusy ? "submitted" : status

  const displayMessages = React.useMemo(
    () => messages.length > 0 ? messages : initialMessages,
    [initialMessages, messages]
  )

  const lastAssistantMessageId = React.useMemo(() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      if (displayMessages[i].role === "assistant") return displayMessages[i].id
    }
    return null
  }, [displayMessages])

  const hasCurrentTurnEnded = status === "ready" || status === "error" || !!error
  const showStreamingIndicator = !isMessagesLoading && (status === "submitted" || status === "streaming") && !error && displayMessages.length > 0

  const doSend = React.useCallback(
    async (message: PromptInputMessage | string) => {
      const messageText = (typeof message === "string" ? message : message.text)?.trim() ?? ""
      if (!messageText || !curatorConversationId) return

      try {
        const pendingMeta = {
          command: command ? { id: command.id, title: command.title } : undefined,
          mentions: mentions.length > 0 ? mentions : undefined,
        }
        await sendMessage(
          { text: messageText },
          {
            body: {
              attachments: typeof message === "string" ? undefined : message.files,
              conversationId: curatorConversationId,
              skill: command?.title ?? "",
              metadata: pendingMeta,
            },
          }
        )
      } catch (sendError) {
        toast.error("发送失败", {
          description: sendError instanceof Error ? sendError.message : "请稍后重试",
        })
      }
    },
    [curatorConversationId, sendMessage, command, mentions]
  )

  const {
    queue: pendingQueue,
    enqueue,
    remove: pendingRemove,
    sendNow: pendingSendNow,
    moveUp: pendingMoveUp,
    moveDown: pendingMoveDown,
  } = usePendingMessages({ status, onSend: doSend, onStop: handleStop })

  const handleSendMessage = React.useCallback(
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

  const { data: executions = [] } = useAllTaskExecutions()

  /* ── Build unified timeline ── */
  const timeline: TimelineEntry[] = React.useMemo(() => {
    const entries: TimelineEntry[] = []

    const now = Date.now()
    const fallbackBase = now - displayMessages.length * 1000
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
      if (exec.run_status === "success" || exec.run_status === "failed" || exec.run_status === "timeout" || exec.run_status === "cancelled") {
        entries.push({
          kind: "execution",
          data: exec,
          ts: exec.ended_at ? new Date(exec.ended_at).getTime() : new Date(exec.started_at).getTime(),
        })
      }
    }

    entries.sort((a, b) => a.ts - b.ts)
    return entries
  }, [displayMessages, executions, storedMessages])

  const isDraft = !curatorConversationId
  const contactDisplayName = contact?.curator?.name ?? "总管助手"

  return (
    <div className="flex flex-1 flex-col bg-background" {...props}>
      <CuratorChatHeader contact={contact} />

      <ConversationUI className="min-h-0 flex-1 overflow-y-auto">
        <ConversationContent>
          {curatorLoading && (
            <div className="flex items-center justify-center py-16">
              <Spinner className="size-5" />
            </div>
          )}

          {!curatorLoading && isDraft && timeline.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
              <p className="text-xs">在下方输入消息，自然语言下发任务给你的数字员工团队</p>
            </div>
          )}

          {timeline.map((entry, i) => {
            if (entry.kind === "execution") {
              const exec = entry.data
              return (
                <Message key={`exec-${exec.id}`} from="assistant" className="mx-auto max-w-4xl">
                  <div className="mb-2 flex items-center gap-2">
                    <EmployeeContactAvatar
                      name={exec.employee_name || String(exec.employee_id)}
                      avatarClassName="size-6"
                      fallbackClassName="text-[10px]"
                    />
                    <span className="text-xs text-muted-foreground">{exec.employee_name || String(exec.employee_id)}</span>
                    <span className="text-[10px] text-muted-foreground/60">{formatTime(entry.ts)}</span>
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
              message.role === "assistant" && message.id === lastAssistantMessageId
            const includeFileChanges =
              message.role === "assistant" && (!isLastAssistantMessage || hasCurrentTurnEnded)
            const classifiedBlocks = classifyMessageParts(message, { includeFileChanges })
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
                ? (messageMeta.mentions as Array<{ id?: string; name?: string }>)
                : []

            return (
              <Message
                key={message.id}
                from={message.role}
                className="mx-auto max-w-4xl"
              >
                {message.role === "assistant" && (
                  <div className="mb-2 flex items-center gap-2">
                    {contact?.type === "curator" ? (
                      <EmployeeContactAvatar
                        name={contact.curator?.name}
                        avatar={contact.curator?.avatar}
                        status={contact.curator?.status}
                        avatarClassName="size-6"
                        fallbackClassName="text-[10px]"
                      />
                    ) : (
                      <EmployeeContactAvatar
                        name={contact?.employee?.name}
                        avatar={contact?.employee?.avatar}
                        avatarClassName="size-6"
                        fallbackClassName="text-[10px]"
                      />
                    )}
                    <span className="text-xs text-muted-foreground">{contactDisplayName}</span>
                    <span className="text-[10px] text-muted-foreground/60 ml-auto">{formatTime(entry.ts)}</span>
                  </div>
                )}
                <MessageContent className="w-auto">
                  <div className="space-y-3">
                    {classifiedBlocks.length > 0 ? (
                      renderClassifiedBlocks(classifiedBlocks, { commandMeta, mentionMeta, messageId: message.id })
                    ) : message.role === "assistant" ? (
                      <MessageResponse />
                    ) : null}
                  </div>
                </MessageContent>
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

      <div className="border-none p-4 max-w-4xl mx-auto w-full">
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
          disabled={!inputValue.trim() || isBusy || curatorLoading}
          size="compact"
          className="w-full overflow-hidden shadow-xl bg-background/80"
          slashCommands={[]}
          mentionCandidates={[]}
        />
        {error && (
          <p className="mt-2 text-xs text-destructive">{error.message}</p>
        )}
      </div>
    </div>
  )
}
