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
import { useMessagesQuery, useCuratorConversationQuery, useOrchestrationPlansQuery } from "@/hooks/use-chat-queries"
import { usePendingMessages } from "@/hooks/use-pending-messages"
import { useAllTaskExecutions } from "@/hooks/use-schedule-monitor-queries"
import { cancelConversationStream } from "@/api/conversation"
import { toast } from "sonner"
import { chatTransport, type ChatViewContact } from "../chat-view-shared"
import { CuratorChatHeader } from "../curator-chat-header"
import { OrchestrationPlanCard } from "../orchestration-plan-card"
import { TaskProgressBar } from "../task-progress-bar"
import { ExecutionReportCard } from "../execution-report-card"
import { ChatPromptInput } from "@/components/chat-prompt-input"
import { PendingMessageQueue } from "../pending-message-queue"
import { EmployeeContactAvatar } from "../contact-avatars"
import {
  renderClassifiedBlocks,
  getMessageMeta,
} from "../chat-panel"
import { useEffect } from "react"
import type { TaskExecution } from "@/types/schedule-monitor"

type TimelineEntry =
  | { kind: "message"; data: UIMessage; ts: number }
  | { kind: "execution"; data: TaskExecution; ts: number }

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

  const { data: plans = [] } = useOrchestrationPlansQuery()

  const pendingPlan = React.useMemo(
    () => plans.find((p: any) => p.status === "pending_confirmation"),
    [plans]
  )

  const executingPlans = React.useMemo(
    () => plans.filter((p: any) => p.status === "executing"),
    [plans]
  )

  const { data: executions = [] } = useAllTaskExecutions()

  const handleConfirm = React.useCallback(
    async (planId: number) => {
      const { request } = await import("@/lib/request")
      await request(`/orchestration/plans/${planId}/confirm`, { method: "PUT" })
    },
    []
  )

  const handleCancel = React.useCallback(
    (planId: number) => {
      import("@/lib/request").then(({ request }) =>
        request(`/orchestration/plans/${planId}/cancel`, { method: "PUT" })
      )
    },
    []
  )

  /* ── Build unified timeline from DB data ── */
  const timeline: TimelineEntry[] = React.useMemo(() => {
    const entries: TimelineEntry[] = []

    for (const msg of displayMessages) {
      entries.push({ kind: "message", data: msg, ts: msg.createdAt?.getTime() ?? Date.now() })
    }

    for (const exec of executions) {
      if (exec.run_status !== "pending") {
        entries.push({
          kind: "execution",
          data: exec,
          ts: new Date(exec.started_at).getTime(),
        })
      }
    }

    entries.sort((a, b) => a.ts - b.ts)
    return entries
  }, [displayMessages, executions])

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

          {pendingPlan && (
            <div className="mx-auto mb-4 max-w-4xl px-4">
              <OrchestrationPlanCard
                planId={pendingPlan.id}
                summary={pendingPlan.user_input || ""}
                tasks={(() => {
                  try {
                    const json = JSON.parse(pendingPlan.plan_json || "[]")
                    return json.map((t: any, i: number) => ({
                      task_id: i,
                      employee_name: t.employee_name || String(t.employee_id),
                      task_name: t.task_name || "",
                      status: "pending" as const,
                      cron: t.cron || null,
                      execute_mode: t.cron ? "scheduled" : "immediate",
                    }))
                  } catch { return [] }
                })()}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
              />
            </div>
          )}

          {!pendingPlan &&
            executingPlans.map((plan: any) => (
              <div key={plan.id} className="mx-auto mb-4 max-w-4xl px-4">
                <TaskProgressBar
                  planId={plan.id}
                  summary={plan.user_input || ""}
                  total={plan.total_tasks || 0}
                  completed={plan.completed_tasks || 0}
                  tasks={(() => {
                    try {
                      const json = JSON.parse(plan.plan_json || "[]")
                      return json.map((t: any, i: number) => ({
                        task_id: i,
                        employee_name: t.employee_name || String(t.employee_id),
                        task_name: t.task_name || "",
                        status: "running" as const,
                        cron: t.cron || null,
                        execute_mode: t.cron ? "scheduled" : "immediate",
                      }))
                    } catch { return [] }
                  })()}
                />
              </div>
            ))}

          {timeline.map((entry) => {
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
                  </div>
                  <MessageContent className="w-auto">
                    <ExecutionReportCard execution={exec} />
                  </MessageContent>
                </Message>
              )
            }

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
