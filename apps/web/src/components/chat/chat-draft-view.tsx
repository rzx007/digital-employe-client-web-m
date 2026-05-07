import {
  useState,
  useCallback,
  useMemo,
  type ComponentProps,
} from "react"
import { useChat } from "@ai-sdk/react"
import type { UIMessage, FileUIPart } from "ai"

import type { PromptInputMessage } from "@workspace/ui/components/ai-elements/prompt-input"
import type { PromptChangeEvent } from "@/components/lexical-editor/prompt-input-textarea"
import { useCreateConversationMutation } from "@/hooks/use-chat-queries"
import { useChatStore } from "@/stores/chat-store"
import { usePendingMessages } from "@/hooks/use-pending-messages"

import { ChatPanel } from "./chat-panel"
import { chatTransport, type ChatViewContact } from "./chat-view-shared"
import { cancelConversationStream, uploadConversationFile } from "@/api/conversation"
import { toast } from "sonner"

async function uploadDraftFiles(
  conversationId: string | number,
  files: FileUIPart[],
): Promise<string[]> {
  const paths: string[] = []
  for (const file of files) {
    const response = await fetch(file.url)
    const blob = await response.blob()
    const fileObj = new File([blob], file.filename || "file", {
      type: file.mediaType,
    })
    const result = await uploadConversationFile(conversationId, fileObj)
    if (result?.data?.path) {
      paths.push(result.data.path)
    } else {
      throw new Error(result?.msg || `上传文件 ${file.filename} 失败`)
    }
  }
  return paths
}

export function DraftChatView({
  contact,
  onOpenContacts,
  onOpenConversations,
  onNewConversation,
  className,
  ...props
}: ComponentProps<"div"> & {
  contact?: ChatViewContact
  onOpenContacts?: () => void
  onOpenConversations?: () => void
  onNewConversation?: () => void
}) {
  const selectedContactId = useChatStore((s) => s.selectedContactId)
  const selectedConversationId = useChatStore((s) => s.selectedConversationId)
  const draftSessionKey = useChatStore((s) => s.draftSessionKey)
  const setSelectedConversationId = useChatStore(
    (s) => s.setSelectedConversationId
  )
  const selectedContact = useChatStore((s) => s.getSelectedContact())
  const [inputValue, setInputValue] = useState("")
  const [command, setCommand] = useState<{ id: string; title: string } | null>(
    null
  )
  const [mentions, setMentions] = useState<Array<{ id: string; name: string }>>(
    []
  )
  const createConversationMutation = useCreateConversationMutation()

  const { messages, setMessages, sendMessage, status, error, stop } = useChat({
    id: selectedContactId
      ? `draft:${selectedContactId}:${draftSessionKey}`
      : `draft:chat-view:${draftSessionKey}`,
    transport: chatTransport,
    onError: (chatError) => {
      toast.error("发送失败", {
        description: chatError.message || "请稍后重试",
      })
    },
  })

  const handleTextChange = useCallback((event: PromptChangeEvent) => {
    setCommand(event.command)
    setMentions(event.mentions)
    setInputValue(event.value)
  }, [])

  const isBusy =
    createConversationMutation.isPending ||
    status === "submitted" ||
    status === "streaming"

  const chatStatus =
    createConversationMutation.isPending && status === "ready"
      ? "submitted"
      : status

  const handleStop = useCallback(async () => {
    if (createConversationMutation.isPending) {
      createConversationMutation.reset()
      return
    }
    stop()
    const conversationId = useChatStore.getState().selectedConversationId
    if (conversationId) {
      try {
        await cancelConversationStream(conversationId)
      } catch { }
    }
  }, [createConversationMutation, stop])

  const isSubmitDisabled = useMemo(() => {
    return !isBusy && !inputValue.trim()
  }, [inputValue, isBusy])

  const doSend = useCallback(
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
        let conversationId = useChatStore.getState().selectedConversationId

        /**
         * 如果当前没有会话，则创建一个新会话
         */
        if (!conversationId) {
          const createdConversation =
            await createConversationMutation.mutateAsync({
              contactId: selectedContactId ?? "",
              title: messageText,
              contact: selectedContact,
            })

          conversationId = createdConversation.id
          setSelectedConversationId(conversationId)
        }

        let uploadedPaths: string[] = []
        if (typeof message !== "string" && message.files?.length) {
          uploadedPaths = await uploadDraftFiles(
            conversationId,
            message.files,
          )
        }

        await sendMessage(
          { text: messageText },
          {
            body: {
              attachments: uploadedPaths.length > 0 ? uploadedPaths : undefined,
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
    [
      command,
      mentions,
      createConversationMutation,
      selectedContactId,
      selectedContact,
      setMessages,
      sendMessage,
      setSelectedConversationId,
    ]
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

  const handleSendMessage = useCallback(
    async (message: PromptInputMessage) => {
      const hasText = Boolean(message.text)
      const messageText = message.text?.trim() ?? ""
      if (!hasText) {
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
      title="新对话"
      messages={messages}
      inputValue={inputValue}
      status={chatStatus}
      error={error}
      isDraftMode={messages.length === 0}
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
      conversationId={selectedConversationId}
      onAttachmentsChange={() => { }}
      className={className}
      {...props}
    />
  )
}
