import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  type ComponentProps,
} from "react"

import { useQueryClient } from "@tanstack/react-query"

import { useChat } from "@ai-sdk/react"

import type { PromptInputMessage } from "@workspace/ui/components/ai-elements/prompt-input"

import { mapStoredMessagesToUIMessages } from "@/lib/chat/message-utils"

import type { PromptChangeEvent } from "@/components/lexical-editor/prompt-input-textarea"

import { useMessagesQuery } from "@/hooks/use-chat-queries"

import {
  useCuratorTaskExecutions,
  useCancelTaskExecution,
} from "@/hooks/use-schedule-monitor-queries"

import { ACTIVE_TASK_RUN_STATUSES } from "@/types/schedule-monitor"

import { usePendingMessages } from "@/hooks/use-pending-messages"

import { useConversationSession } from "@/hooks/use-conversation-session"

import { prepareDisplayMessages } from "@/lib/chat/hitl"

import { pickMessageDisplaySource } from "@/lib/chat/pick-message-display-source"
import { getLastAssistantMessage } from "@/lib/chat/message-query-cache"
import {
  isBenignStreamAbortError,
  isStreamDisconnectedError,
} from "@/lib/chat/stream-abort"

import { useSyncPendingFromComposer } from "@/hooks/use-sync-pending-from-composer"

import { ChatPanel } from "../panel/chat-panel"

import { chatTransport, type ChatViewContact } from "../shared/chat-view-shared"

import { cancelConversationStream } from "@/api/chat"
import { getContactId } from "@/lib/chat/contact-utils"
import { prepareVoiceMeta } from "@/lib/voice/prepare-voice-meta"
import type { VoiceMessageMeta } from "@/types/chat"

import { toast } from "sonner"

export function ConversationChatView({
  contact,

  title,

  conversationId,

  onOpenContacts,

  onOpenConversations,

  onNewConversation,

  readOnly = false,

  className,

  ...props
}: ComponentProps<"div"> & {
  contact?: ChatViewContact

  title: string

  conversationId: string | number

  onOpenContacts?: () => void

  onOpenConversations?: () => void

  onNewConversation?: () => void

  /** 只读：员工任务执行会话钻取，仅查看转录、隐藏输入区 */
  readOnly?: boolean
}) {
  const [inputValue, setInputValue] = useState("")

  const [command, setCommand] = useState<{
    id: string

    title: string
  } | null>(null)

  const [mentions, setMentions] = useState<
    Array<{
      id: string

      name: string
    }>
  >([])

  const queryClient = useQueryClient()

  const {
    data: storedMessages = [],

    isPending: isMessagesLoading,

    isError: isMessagesError,
  } = useMessagesQuery(conversationId)

  useEffect(() => {
    if (isMessagesError) {
      toast.error("加载历史消息失败")
    }
  }, [isMessagesError])

  const initialMessages = useMemo(
    () => mapStoredMessagesToUIMessages(storedMessages),

    [storedMessages]
  )

  // 后端是否仍在跑：DB 末条 assistant streamState=streaming。长执行/子任务期间 SSE 常
  // 「假结束」(本地 status=ready) 但后端仍活跃——据此把会话识别为「忙」，让发送走排队、
  // 不误判空闲而把在跑的流抢占掉（修：子任务在跑时发消息报「流超时仍未结束，已清理」）。
  const lastStoredStreamState =
    getLastAssistantMessage(storedMessages)?.streamState ?? null
  const backendStreaming = lastStoredStreamState === "streaming"

  // 总管派发的员工任务在后台异步跑(总管自身已收尾、无活跃流)时也算忙：发送走排队、
  // 等任务跑完再发，避免边跑边发打断编排链路。仅总管会话有意义(员工会话无总管任务)。
  // 查询按会话缓存，与头部「N 个任务在执行」指示器同一份(react-query 去重，无额外开销)。
  const { data: curatorExecutions = [] } = useCuratorTaskExecutions(
    contact?.type === "curator" ? conversationId : null
  )
  const runningExecutions = curatorExecutions.filter((e) =>
    ACTIVE_TASK_RUN_STATUSES.has(e.run_status)
  )
  const tasksRunning = runningExecutions.length > 0
  const cancelExec = useCancelTaskExecution(conversationId)

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
    id: String(conversationId),

    transport: chatTransport,

    onFinish: () => {
      onStreamFinishRef.current()
    },

    onError: (chatError) => {
      // 主动 abort（切会话/卸载）或 SSE 在 turn 结束前断开 → 尝试 resume 续流，
      // 不向用户报错。后者是执行会话「假结束」的根因修复（B 根治）。
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
    conversationId,
    contactId: getContactId(contact),

    storedMessages,

    initialMessages,

    composerMessages: messages,

    status,

    setMessages,

    resumeStream,

    queryClient,
  })

  useSyncPendingFromComposer(conversationId, messages, status)

  useEffect(() => {
    onStreamFinishRef.current = session.onStreamFinish
    onRetryResumeRef.current = session.retryResumeIfNeeded
  }, [session.onStreamFinish, session.retryResumeIfNeeded])

  const handleStop = useCallback(async () => {
    stop()

    chatTransport.cancelReconnect()

    const chatWasBusy =
      status === "submitted" || status === "streaming" || backendStreaming

    if (chatWasBusy) {
      try {
        await cancelConversationStream(conversationId)
      } catch {
        toast.error("停止对话失败")
        return
      }
    }

    // 中止所有在跑的员工任务(点停止=真的停掉编排，其依赖的后续任务后端会一并跳过)。
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
  }, [
    conversationId,
    session,
    status,
    stop,
    backendStreaming,
    runningExecutions,
    cancelExec,
  ])

  const prevConversationIdRef = useRef(conversationId)

  useEffect(() => {
    if (prevConversationIdRef.current !== conversationId) {
      chatTransport.cancelReconnect()
      prevConversationIdRef.current = conversationId
    }
  }, [conversationId])

  // 卸载（切走会话 / 切联系人 / 群深链 remount）时断开本会话尚在进行的 SSE 连接：
  // - resume 流由 transport 内部独立 AbortController 持有，useChat 卸载**不会**自动中止它；
  // - live POST 流走 stop()。
  // 不主动断开会泄漏长连接——浏览器对同源并发连接数有限（HTTP/1.1 ~6），来回切几次就把
  // 连接池占满，之后所有后台接口（含 GET /messages）都拿不到 socket → 整页「卡死、无法请求」。
  // 后端 turn 仍在跑，切回会话时 effect 会重新 resume 续上，不丢内容。
  const stopRef = useRef(stop)
  useEffect(() => {
    stopRef.current = stop
  }, [stop])
  useEffect(() => {
    return () => {
      chatTransport.cancelReconnect()
      stopRef.current()
    }
  }, [])

  // 断流错误（StreamDisconnectedError）已由 onError 触发 resume 续流接管，不是用户
  // 可见的失败；连同主动 abort 一并从展示错误里滤掉，否则会弹「SSE 流在收到终止信号
  // 前断开」红条吓到用户（其实后台仍在跑/已自动续上）。
  const displayError =
    error &&
    !isBenignStreamAbortError(error) &&
    !isStreamDisconnectedError(error)
      ? error
      : undefined

  const displayMessages = useMemo(() => {
    const source = pickMessageDisplaySource(messages, initialMessages, status)
    return prepareDisplayMessages(source)
  }, [initialMessages, messages, status])

  const handleHitlApproved = useCallback(
    (options?: Parameters<typeof session.onHitlApproved>[0]) => {
      session.onHitlApproved(options)
    },
    [session.onHitlApproved]
  )

  const handleTextChange = useCallback((event: PromptChangeEvent) => {
    setCommand(event.command)

    setMentions(event.mentions)

    setInputValue(event.value)
  }, [])

  const isBusy = status === "submitted" || status === "streaming"

  // 含「后端仍在跑」(总管自身的流) + 「员工任务在后台跑」：用于发送决策(走排队)、禁用态。
  const effectiveBusy = isBusy || backendStreaming || tasksRunning

  // 忙但本地 status=ready(后端仍在跑/员工任务在后台跑)时，提交按钮显示「停止」(■)，
  // 点击 handleStop 会取消总管流并中止所有在跑任务。
  const chatStatus: typeof status =
    effectiveBusy && status === "ready" ? "submitted" : status

  const isSubmitDisabled = useMemo(() => {
    if (effectiveBusy) {
      return false
    }
    return !inputValue.trim()
  }, [inputValue, effectiveBusy])

  const uploadedPathsRef = useRef<string[]>([])

  const doSend = useCallback(
    async (message: PromptInputMessage | string) => {
      const messageText =
        (typeof message === "string" ? message : message.text)?.trim() ?? ""

      if (!messageText) return

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
      if (voicePayload && conversationId != null) {
        try {
          voiceMeta = await prepareVoiceMeta(conversationId, voicePayload)
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

        await sendMessage(
          { text: messageText, metadata: pendingMeta },

          {
            body: {
              conversationId,

              skill: command?.title ?? "",

              metadata: pendingMeta,
            },
          }
        )
      } catch (sendError) {
        // 用户可见的失败提示由 useChat 的 onError 统一负责（避免重复弹窗）；
        // 这里仅保证发送前/同步抛出的错误不被静默吞掉，便于诊断。
        if (import.meta.env.DEV) {
          console.error("[chat] doSend failed:", sendError)
        }
      }
    },

    [command, mentions, sendMessage, conversationId, session]
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

  const handleSendMessage = useCallback(
    async (message: PromptInputMessage) => {
      const hasText = Boolean(message.text)

      const hasAttachments = Boolean(message.files?.length)

      const messageText = message.text?.trim() ?? ""

      if (!(hasText || hasAttachments)) {
        return
      }

      if (!messageText) {
        toast.error("暂不支持仅发送附件")

        return
      }

      // 语音消息绕过 pending 队列：队列入队项不携带 voice 载荷，
      // 走队列会静默降级为纯文本。
      const voicePayload = message.voice

      if (effectiveBusy && !voicePayload) {
        enqueue({
          id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,

          text: messageText,

          command: command ? { id: command.id, title: command.title } : null,

          mentions: mentions.length > 0 ? [...mentions] : undefined,
        })

        setInputValue("")

        return
      }

      if (effectiveBusy && voicePayload) {
        // 语音不进 pending 队列（队列项不携带 voice 载荷），
        // 而 useChat 客户端是单流模型：先停掉进行中的流再发送（对齐 sendNow 先例）。
        await handleStop()
      }

      // 语音消息的文本来自转写，与输入框草稿无关：不清空草稿。
      if (!voicePayload) {
        setInputValue("")
      }

      await doSend(message)
    },

    [effectiveBusy, enqueue, command, mentions, doSend, handleStop]
  )

  return (
    <ChatPanel
      contact={contact}
      title={title}
      messages={displayMessages}
      composerMessages={messages}
      inputValue={inputValue}
      status={chatStatus}
      storedAssistantStreamState={lastStoredStreamState}
      error={displayError}
      isDraftMode={false}
      isMessagesLoading={isMessagesLoading}
      isSubmitDisabled={isSubmitDisabled}
      onInputChange={handleTextChange}
      onSend={handleSendMessage}
      onStop={handleStop}
      onOpenContacts={onOpenContacts}
      onOpenConversations={onOpenConversations}
      onNewConversation={onNewConversation}
      pendingMessages={pendingQueue}
      onPendingRemove={pendingRemove}
      onPendingSendNow={pendingSendNow}
      onPendingMoveUp={pendingMoveUp}
      onPendingMoveDown={pendingMoveDown}
      conversationId={conversationId}
      onAttachmentsChange={handleAttachmentsChange}
      activeHitl={session.activeHitl}
      onHitlApproved={handleHitlApproved}
      readOnly={readOnly}
      className={className}
      {...props}
    />
  )
}
