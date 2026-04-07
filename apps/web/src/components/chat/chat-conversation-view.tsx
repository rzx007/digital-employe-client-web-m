import * as React from "react"
import { useChat } from "@ai-sdk/react"
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
  const previousSessionIdRef = React.useRef<string | null>(null)

  const { data: storedMessages = [] } = useMessagesQuery(conversationId)

  const initialMessages = React.useMemo(
    () => mapStoredMessagesToUIMessages(storedMessages),
    [storedMessages]
  )

  const { messages, setMessages, sendMessage, status, error } = useChat({
    id: String(conversationId),
    messages: initialMessages,
    transport: chatTransport,
    // resume: false,
    onError: (chatError) => {
      toast.error("发送失败", {
        description: chatError.message || "请稍后重试",
      })
    },
  })

  React.useEffect(() => {
    if (previousSessionIdRef.current === String(conversationId)) {
      return
    }

    previousSessionIdRef.current = String(conversationId)
    setMessages(initialMessages)
  }, [conversationId, initialMessages, setMessages])

  const handleTextChange = React.useCallback((event: PromptChangeEvent) => {
    setCommand(event.command)
    setInputValue(event.value)
  }, [])

  const isBusy = status === "submitted" || status === "streaming"
  const chatStatus = status === "ready" && isBusy ? "submitted" : status

  const isSubmitDisabled = React.useMemo(() => {
    return !(inputValue.trim() || status) || status === "streaming" || isBusy
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
    [conversationId, sendMessage]
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
      conversationId={conversationId}
      messages={displayMessages}
      storedMessages={storedMessages}
      inputValue={inputValue}
      status={chatStatus}
      error={error}
      isDraftMode={false}
      isSubmitDisabled={isSubmitDisabled}
      onInputChange={handleTextChange}
      onSend={handleSendMessage}
      onOpenContacts={onOpenContacts}
      onOpenConversations={onOpenConversations}
      onNewConversation={onNewConversation}
      className={className}
      {...props}
    />
  )
}
