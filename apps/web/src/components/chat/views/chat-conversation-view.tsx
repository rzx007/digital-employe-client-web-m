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

import { usePendingMessages } from "@/hooks/use-pending-messages"

import { useConversationSession } from "@/hooks/use-conversation-session"

import { prepareDisplayMessages } from "@/lib/chat/hitl"

import { pickMessageDisplaySource } from "@/lib/chat/pick-message-display-source"
import { isBenignStreamAbortError } from "@/lib/chat/stream-abort"
import {
  isTerminalAssistantStreamState,
  lastStoredAssistantStreamState,
} from "@/lib/chat/assistant-stream-state"
import { getLastAssistantMessage } from "@/lib/chat/message-query-cache"

import { useSyncPendingFromComposer } from "@/hooks/use-sync-pending-from-composer"

import { ChatPanel } from "../panel/chat-panel"

import { chatTransport, type ChatViewContact } from "../shared/chat-view-shared"

import { cancelConversationStream } from "@/api/chat"
import { getContactId } from "@/lib/chat/contact-utils"
import {
  isGroupDeepLinkExecutionView,
} from "@/lib/chat/group-navigation"
import { chatKeys } from "@/lib/query-keys/chat"
import { useChatStore } from "@/stores/chat-store"

import { toast } from "sonner"

export function ConversationChatView({
  contact,

  title,

  conversationId,

  onOpenContacts,

  onOpenConversations,

  onNewConversation,

  className,

  ...props
}: ComponentProps<"div"> & {
  contact?: ChatViewContact

  title: string

  conversationId: string | number

  onOpenContacts?: () => void

  onOpenConversations?: () => void

  onNewConversation?: () => void
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
  const groupNavigationReturn = useChatStore((s) => s.groupNavigationReturn)
  const isGroupExecutionView = isGroupDeepLinkExecutionView(
    groupNavigationReturn,
    conversationId
  )

  const {
    data: storedMessages = [],

    isPending: isMessagesLoading,

    isFetching: isMessagesFetching,

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
      if (isBenignStreamAbortError(chatError)) {
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

    isMessagesFetching,

    setMessages,

    resumeStream,

    queryClient,
  })

  useSyncPendingFromComposer(conversationId, messages, status)

  useEffect(() => {
    onStreamFinishRef.current = session.onStreamFinish
    onRetryResumeRef.current = session.retryResumeIfNeeded
  }, [session.onStreamFinish, session.retryResumeIfNeeded])

  // DB 已终态/queued 但 useChat 残留 streaming → 清掉误显示的「正在生成…」
  useEffect(() => {
    const last = getLastAssistantMessage(storedMessages)
    const busy = status === "streaming" || status === "submitted"
    if (!busy || !last) return

    const dbQueued = last.streamState === "queued"
    const dbTerminal = isTerminalAssistantStreamState(last.streamState ?? undefined)
    if (dbQueued || dbTerminal) {
      stop()
    }
  }, [conversationId, storedMessages, status, stop])

  const storedStreamState = lastStoredAssistantStreamState(storedMessages)
  // SSE 未接上时轮询 DB checkpoint，避免群深链执行会话长时间空白
  const pollGroupExecution =
    isGroupExecutionView &&
    storedStreamState === "streaming" &&
    status !== "streaming" &&
    status !== "submitted"

  useEffect(() => {
    if (!pollGroupExecution) return
    const timer = setInterval(() => {
      void queryClient.invalidateQueries({
        queryKey: chatKeys.messages(String(conversationId)),
      })
    }, 1500)
    return () => clearInterval(timer)
  }, [pollGroupExecution, conversationId, queryClient])

  const handleStop = useCallback(async () => {
    stop()

    chatTransport.cancelReconnect()

    try {
      await cancelConversationStream(conversationId)
    } catch {
      toast.error("停止对话失败")
    }

    session.onStreamStopped()
  }, [stop, conversationId, session])

  const prevConversationIdRef = useRef(conversationId)

  useEffect(() => {
    if (prevConversationIdRef.current !== conversationId) {
      chatTransport.cancelReconnect()
      prevConversationIdRef.current = conversationId
    }
  }, [conversationId])

  const displayError =
    error && !isBenignStreamAbortError(error) ? error : undefined

  const displayMessages = useMemo(() => {
    const source = pickMessageDisplaySource(
      messages,
      initialMessages,
      status,
      { preferStoredWhileDbStreaming: isGroupExecutionView }
    )

    return prepareDisplayMessages(source)
  }, [initialMessages, messages, status, isGroupExecutionView])

  const handleTextChange = useCallback((event: PromptChangeEvent) => {
    setCommand(event.command)

    setMentions(event.mentions)

    setInputValue(event.value)
  }, [])

  const isBusy = status === "submitted" || status === "streaming"

  const chatStatus = status === "ready" && isBusy ? "submitted" : status

  const isSubmitDisabled = useMemo(() => {
    if (status === "submitted" || status === "streaming") {
      return false
    }
    return !inputValue.trim()
  }, [inputValue, status])

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

      const pendingMeta = {
        command: command ? { id: command.id, title: command.title } : undefined,

        mentions: mentions.length > 0 ? mentions : undefined,

        files: filesMeta,
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

      if (isBusy) {
        enqueue({
          id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,

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

    [isBusy, enqueue, command, mentions, doSend]
  )

  return (
    <ChatPanel
      contact={contact}
      title={title}
      messages={displayMessages}
      composerMessages={messages}
      storedAssistantStreamState={lastStoredAssistantStreamState(storedMessages)}
      inputValue={inputValue}
      status={chatStatus}
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
      onHitlApproved={session.onHitlApproved}
      className={className}
      {...props}
    />
  )
}
