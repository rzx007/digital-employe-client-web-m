import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  type ComponentProps,
} from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useChat } from "@ai-sdk/react"
import type { FileUIPart } from "ai"

import type { PromptInputMessage } from "@workspace/ui/components/ai-elements/prompt-input"
import type { PromptChangeEvent } from "@/components/lexical-editor/prompt-input-textarea"
import {
  useCreateConversationMutation,
  useMessagesQuery,
} from "@/hooks/use-chat-queries"
import { useConversationSession } from "@/hooks/use-conversation-session"
import { useChatStore } from "@/stores/chat-store"
import { usePendingMessages } from "@/hooks/use-pending-messages"
import { prepareDisplayMessages } from "@/lib/chat/hitl"
import { mapStoredMessagesToUIMessages } from "@/lib/chat/message-utils"
import { useSyncPendingFromComposer } from "@/hooks/use-sync-pending-from-composer"

import { ChatPanel } from "../panel/chat-panel"
import { chatTransport, type ChatViewContact } from "../shared/chat-view-shared"
import {
  cancelConversationStream,
  uploadConversationFile,
} from "@/api/chat"
import { toast } from "sonner"

async function uploadDraftFiles(
  conversationId: string | number,
  files: FileUIPart[]
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
  hideHeader = false,
  className,
  ...props
}: ComponentProps<"div"> & {
  contact?: ChatViewContact
  onOpenContacts?: () => void
  onOpenConversations?: () => void
  onNewConversation?: () => void
  hideHeader?: boolean
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
  const conversationIdRef = useRef<string | number | null>(null)
  const createConversationMutation = useCreateConversationMutation()
  const queryClient = useQueryClient()

  const { data: storedMessages = [] } = useMessagesQuery(selectedConversationId)

  const initialMessages = useMemo(
    () => mapStoredMessagesToUIMessages(storedMessages),
    [storedMessages]
  )

  const onStreamFinishRef = useRef<() => void>(() => { })

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    error,
    stop,
    resumeStream,
  } = useChat({
    id: selectedContactId
      ? `draft:${selectedContactId}:${draftSessionKey}`
      : `draft:chat-view:${draftSessionKey}`,
    transport: chatTransport,
    onError: (chatError) => {
      toast.error("发送失败", {
        description: chatError.message || "请稍后重试",
      })
    },
    onFinish: () => {
      onStreamFinishRef.current()
    },
  })

  const session = useConversationSession({
    conversationId: selectedConversationId,
    storedMessages,
    initialMessages,
    composerMessages: messages,
    status,
    setMessages,
    resumeStream,
    queryClient,
  })

  useSyncPendingFromComposer(selectedConversationId, messages, status)

  useEffect(() => {
    onStreamFinishRef.current = session.onStreamFinish
  }, [session.onStreamFinish])

  // draftSessionKey 变化时重置 composer（新建会话 / 草稿内删光当前会话）。
  // 仅 bump key 时 useChat 不一定清空 messages，且 useMessagesQuery 禁用后仍可能保留上一份 data。
  useEffect(() => {
    setMessages([])
    conversationIdRef.current = null
  }, [draftSessionKey, setMessages])

  const handleTextChange = useCallback((event: PromptChangeEvent) => {
    setCommand(event.command)
    setMentions(event.mentions)
    setInputValue(event.value)
  }, [])

  const handleDraftSuggestionSelect = useCallback((text: string) => {
    setInputValue(text)
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
    chatTransport.cancelReconnect()
    const conversationId = useChatStore.getState().selectedConversationId
    if (conversationId) {
      try {
        await cancelConversationStream(conversationId)
      } catch {
        // ignore cancel errors
      }
    }
  }, [createConversationMutation, stop])

  const isSubmitDisabled = useMemo(() => {
    return !isBusy && !inputValue.trim()
  }, [inputValue, isBusy])

  const doSend = useCallback(
    async (message: PromptInputMessage | string) => {
      const messageText =
        (typeof message === "string" ? message : message.text)?.trim() ?? ""
      if (!messageText) return

      session.prepareOutboundMessage()

      const pendingMetaBase = {
        command: command ? { id: command.id, title: command.title } : undefined,
        mentions: mentions.length > 0 ? mentions : undefined,
      }

      try {
        let conversationId = useChatStore.getState().selectedConversationId

        if (!conversationId) {
          const createdConversation =
            await createConversationMutation.mutateAsync({
              contactId: selectedContactId ?? "",
              title: messageText,
              contact: selectedContact,
            })

          conversationId = createdConversation.id
          setSelectedConversationId(conversationId)
          conversationIdRef.current = conversationId
        }

        conversationIdRef.current = conversationId

        let uploadedPaths: string[] = []
        if (typeof message !== "string" && message.files?.length) {
          uploadedPaths = await uploadDraftFiles(conversationId, message.files)
        }

        const filesMeta =
          uploadedPaths.length > 0
            ? uploadedPaths.map((p) => ({
              path: p,
              name: p.split("/").pop() ?? p,
            }))
            : undefined
        const pendingMeta = filesMeta
          ? { ...pendingMetaBase, files: filesMeta }
          : pendingMetaBase

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
      sendMessage,
      setSelectedConversationId,
      session,
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

  const displayMessages = useMemo(
    () => prepareDisplayMessages(messages),
    [messages]
  )

  return (
    <ChatPanel
      contact={contact}
      title="新对话"
      messages={displayMessages}
      composerMessages={messages}
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
      activeHitl={session.activeHitl}
      onHitlApproved={session.onHitlApproved}
      onAttachmentsChange={() => { }}
      onDraftSuggestionSelect={
        contact?.type === "curator" ? handleDraftSuggestionSelect : undefined
      }
      hideHeader={hideHeader}
      className={className}
      {...props}
    />
  )
}
