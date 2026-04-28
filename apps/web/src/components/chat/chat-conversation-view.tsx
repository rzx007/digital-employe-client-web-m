import * as React from "react"
import { useChat } from "@ai-sdk/react"
import type { UIMessage } from "ai"
import type { PromptInputMessage } from "@workspace/ui/components/ai-elements/prompt-input"
import { mapStoredMessagesToUIMessages } from "@/lib/chat/message-utils"
import type { PromptChangeEvent } from "@/components/lexical-editor/prompt-input-textarea"
import { useMessagesQuery } from "@/hooks/use-chat-queries"
import { usePendingMessages } from "@/hooks/use-pending-messages"

import { ChatPanel } from "./chat-panel"
import { chatTransport, type ChatViewContact } from "./chat-view-shared"
import { cancelConversationStream } from "@/api/conversation"
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
}: React.ComponentProps<"div"> & {
  contact?: ChatViewContact
  title: string
  conversationId: string | number
  onOpenContacts?: () => void
  onOpenConversations?: () => void
  onNewConversation?: () => void
}) {
  const [inputValue, setInputValue] = React.useState("")
  const [command, setCommand] = React.useState<{
    id: string
    title: string
  } | null>(null)
  const [mentions, setMentions] = React.useState<Array<{
    id: string
    name: string
  }>>([])
  const { data: storedMessages = [], isPending: isMessagesLoading, isError: isMessagesError } = useMessagesQuery(conversationId)

  React.useEffect(() => {
    if (isMessagesError) {
      toast.error("加载历史消息失败")
    }
  }, [isMessagesError])

  const initialMessages = React.useMemo(
    () => mapStoredMessagesToUIMessages(storedMessages),
    [storedMessages]
  )

  const { messages, setMessages, sendMessage, status, error, stop, resumeStream } = useChat({
    id: String(conversationId),
    messages: initialMessages,
    transport: chatTransport,
    onFinish: () => {},
    onError: (chatError) => {
      toast.error("发送失败", {
        description: chatError.message || "请稍后重试",
      })
    },
  })

  const handleStop = React.useCallback(async () => {
    stop()
    try {
      await cancelConversationStream(conversationId)
    } catch {
      toast.error("停止对话失败")
    }
  }, [stop, conversationId])

  React.useEffect(() => {
    if (initialMessages.length > 0) {
      setMessages(initialMessages)

      const lastStored = storedMessages[storedMessages.length - 1]
      if (lastStored?.role === "assistant" && lastStored.streamState === "streaming") {
        resumeStream()
      }
    }
  }, [conversationId, initialMessages, setMessages, resumeStream, storedMessages])

  const handleTextChange = React.useCallback((event: PromptChangeEvent) => {
    setCommand(event.command)
    setMentions(event.mentions)
    setInputValue(event.value)
  }, [])

  const isBusy = status === "submitted" || status === "streaming"
  const chatStatus = status === "ready" && isBusy ? "submitted" : status

  const isSubmitDisabled = React.useMemo(() => {
    return !(inputValue.trim() || status) || status === "submitted" || (isBusy && status !== "streaming")
  }, [inputValue, isBusy, status])

  const doSend = React.useCallback(
    async (message: PromptInputMessage | string) => {
      const messageText = (typeof message === "string" ? message : message.text)?.trim() ?? ""
      if (!messageText) return

      const pendingMeta = {
        command: command ? { id: command.id, title: command.title } : undefined,
        mentions: mentions.length > 0 ? mentions : undefined,
      }
      const hasPendingMeta = Boolean(
        pendingMeta.command || pendingMeta.mentions?.length
      )

      try {
        await sendMessage(
          { text: messageText },
          {
            body: {
              attachments: typeof message === "string" ? undefined : message.files,
              conversationId,
              skill: command?.title ?? "",
              metadata: pendingMeta,
            },
          }
        )

        if (hasPendingMeta) {
          setMessages((prev) => {
            const next = [...prev]
            for (let i = next.length - 1; i >= 0; i--) {
              if (next[i].role === "user") {
                ; (
                  next[i] as UIMessage & {
                    metadata?: typeof pendingMeta
                  }
                ).metadata = pendingMeta
                break
              }
            }
            return next
          })
        }
      } catch (sendError) {
        toast.error("发送失败", {
          description:
            sendError instanceof Error ? sendError.message : "请稍后重试",
        })
      }
    },
    [conversationId, sendMessage, command, mentions]
  )

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

  const handleSendMessage = React.useCallback(
    async (message: PromptInputMessage) => {
      const hasText = Boolean(message.text)
      const hasAttachments = Boolean(message.files?.length)
      const messageText = message.text?.trim() ?? ""

      const hasImageAttachment = Boolean(
        message.files?.some((file) => {
          const mediaType = "mediaType" in file ? file.mediaType : undefined
          const filename = "filename" in file ? file.filename : undefined

          return (
            mediaType?.startsWith("image/") ||
            Boolean(filename?.match(/\.(png|jpe?g|gif|webp|bmp|svg)$/i))
          )
        })
      )

      if (!(hasText || hasAttachments)) {
        return
      }

      if (hasImageAttachment) {
        toast.error("当前模型不支持图片输入，请移除图片后再发送")
        return
      }

      if (!messageText) {
        toast.error("暂不支持仅发送附件")
        return
      }

      if (message.files?.length) {
        toast.success("Files attached", {
          description: `${message.files.length} file(s) attached to message`,
        })
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

  const displayMessages = React.useMemo(() => {
    if (messages.length > 0) {
      return messages
    }

    return initialMessages
  }, [initialMessages, messages])

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
      className={className}
      {...props}
    />
  )
}
