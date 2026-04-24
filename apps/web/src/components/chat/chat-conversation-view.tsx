import * as React from "react"
import { useChat } from "@ai-sdk/react"
import type { UIMessage } from "ai"
import type { PromptInputMessage } from "@workspace/ui/components/ai-elements/prompt-input"
import { mapStoredMessagesToUIMessages } from "@/lib/chat/message-utils"
import type { PromptChangeEvent } from "@/components/lexical-editor/prompt-input-textarea"
import { useMessagesQuery } from "@/hooks/use-chat-queries"

import { ChatPanel } from "./chat-panel"
import { chatTransport, type ChatViewContact } from "./chat-view-shared"
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
  const { data: storedMessages = [] } = useMessagesQuery(conversationId)

  const initialMessages = React.useMemo(
    () => mapStoredMessagesToUIMessages(storedMessages),
    [storedMessages]
  )

  const { messages, setMessages, sendMessage, status, error, stop } = useChat({
    id: String(conversationId),
    messages: initialMessages,
    transport: chatTransport,
    resume: true,
    onFinish: () => {
      // queryClient.invalidateQueries({
      //   queryKey: chatKeys.messages(String(conversationId)),
      // })
    },
    onError: (chatError) => {
      toast.error("发送失败", {
        description: chatError.message || "请稍后重试",
      })
    },
  })

  React.useEffect(() => {
    if (initialMessages.length > 0) {
      setMessages(initialMessages)
    }
  }, [conversationId, initialMessages, setMessages])

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

      const pendingMeta = {
        command: command ? { id: command.id, title: command.title } : undefined,
        mentions: mentions.length > 0 ? mentions : undefined,
      }
      const hasPendingMeta = Boolean(
        pendingMeta.command || pendingMeta.mentions?.length
      )

      try {
        setInputValue("")

        await sendMessage(
          {
            text: messageText,
          },
          {
            body: {
              attachments: message.files,
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
      isSubmitDisabled={isSubmitDisabled}
      onInputChange={handleTextChange}
      onSend={handleSendMessage}
      onStop={stop}
      onOpenContacts={onOpenContacts}
      onOpenConversations={onOpenConversations}
      onNewConversation={onNewConversation}
      className={className}
      {...props}
    />
  )
}
