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

import { ChatPanel } from "../panel/chat-panel"
import { chatTransport, type ChatViewContact } from "../shared/chat-view-shared"
import { cancelConversationStream } from "@/api/conversation"
import { chatKeys } from "@/lib/query-keys/chat"
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
  const [hasReceivedMessages, setHasReceivedMessages] = useState(false)
  const [hitlInterrupted, setHitlInterrupted] = useState(false)
  const [streamId, setStreamId] = useState<string | null>(null)
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
    messages: initialMessages,
    transport: chatTransport,
    onFinish: () => {
      void queryClient.invalidateQueries({
        queryKey: chatKeys.messages(String(conversationId)),
      })
    },
    onError: () => {
    },
  })

  useEffect(() => {
    chatTransport.onStreamId = (id: string) => {
      setStreamId(id)
    }
    chatTransport.onInterrupted = (payload) => {
      if (payload.stream_id) setStreamId(payload.stream_id)
      setHitlInterrupted(true)
      void queryClient.invalidateQueries({
        queryKey: chatKeys.messages(String(conversationId)),
      })
    }
    return () => {
      chatTransport.onStreamId = null
      chatTransport.onInterrupted = null
    }
  }, [conversationId, queryClient])

  const handleStop = useCallback(async () => {
    stop()
    chatTransport.cancelReconnect()
    try {
      await cancelConversationStream(conversationId)
    } catch {
      toast.error("停止对话失败")
    }
  }, [stop, conversationId])

  // 组件卸载时停止对话
  useEffect(() => {
    return () => {
      console.log("🚀 ~ useEffect ~ 组件卸载时停止对话")
      stop()
    }
  }, [stop])

  useEffect(() => {
    if (messages.length > 0 && !hasReceivedMessages) {
      setHasReceivedMessages(true)
    }
  }, [messages, hasReceivedMessages])

  useEffect(() => {
    if (initialMessages.length === 0) return

    // 正在恢复流时不要覆盖 useChat 已累积的状态
    if (status === "streaming" || status === "submitted") return

    setMessages(initialMessages)

    const lastStored = storedMessages[storedMessages.length - 1]
    if (
      lastStored?.role === "assistant" &&
      lastStored.streamState === "streaming" &&
      (status === "ready" || status === "error") &&
      !hitlInterrupted
    ) {
      const rafId = requestAnimationFrame(() => {
        // rAF 执行时重检 status
        if (status !== "ready" && status !== "error") return
        resumeStream()
      })
      return () => cancelAnimationFrame(rafId)
    }
    // status 是防护，不用加入依赖数组
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    conversationId,
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

  const isSubmitDisabled = useMemo(() => {
    return (
      !(inputValue.trim() || status) ||
      status === "submitted" ||
      (isBusy && status !== "streaming")
    )
  }, [inputValue, isBusy, status])

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
        setHitlInterrupted(false)
        setStreamId(null)
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
      } catch {
        // toast.error("发送失败!", { description: sendError instanceof Error ? sendError.message : "请稍后重试" })
      }
    },
    [command, mentions, sendMessage, conversationId]
  )

  const uploadedPathsRef = useRef<string[]>([])

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

  const displayMessages = useMemo(() => {
    if (messages.length > 0 || hasReceivedMessages) {
      return messages
    }

    return initialMessages
  }, [initialMessages, messages, hasReceivedMessages])

  return (
    <ChatPanel
      contact={contact}
      title={title}
      messages={displayMessages}
      inputValue={inputValue}
      status={chatStatus}
      error={error}
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
      className={className}
      {...props}
    />
  )
}
