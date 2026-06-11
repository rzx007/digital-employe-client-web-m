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
  useUpdateConversationTitleMutation,
} from "@/hooks/use-chat-queries"
import { useConversationSession } from "@/hooks/use-conversation-session"
import { useChatStore } from "@/stores/chat-store"
import { usePendingMessages } from "@/hooks/use-pending-messages"
import { prepareDisplayMessages } from "@/lib/chat/hitl"
import { mapStoredMessagesToUIMessages } from "@/lib/chat/message-utils"
import { pickMessageDisplaySource } from "@/lib/chat/pick-message-display-source"
import { useSyncPendingFromComposer } from "@/hooks/use-sync-pending-from-composer"
import {
  applySemanticConversationTitle,
  DEFAULT_CONVERSATION_TITLE,
} from "@/lib/chat/conversation-title"
import { getContactId } from "@/lib/chat/contact-utils"
import { prepareVoiceMeta } from "@/lib/voice/prepare-voice-meta"
import type { VoiceMessageMeta } from "@/types/chat"

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
  title,
  onOpenContacts,
  onOpenConversations,
  onNewConversation,
  hideHeader = false,
  className,
  ...props
}: ComponentProps<"div"> & {
  contact?: ChatViewContact
  title?: string
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
  const updateTitleMutation = useUpdateConversationTitleMutation()
  const queryClient = useQueryClient()

  const { data: storedMessages = [] } = useMessagesQuery(selectedConversationId)

  const initialMessages = useMemo(
    () => mapStoredMessagesToUIMessages(storedMessages),
    [storedMessages]
  )

  const onStreamFinishRef = useRef<() => void>(() => {})

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
    contactId: selectedContactId,
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
    session.onStreamStopped()
  }, [createConversationMutation, stop, session])

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
        let createdOnThisSend = false

        if (!conversationId) {
          const createdConversation =
            await createConversationMutation.mutateAsync({
              contactId: selectedContactId ?? "",
              title: DEFAULT_CONVERSATION_TITLE,
              contact: selectedContact,
            })

          conversationId = createdConversation.id
          setSelectedConversationId(conversationId)
          conversationIdRef.current = conversationId
          createdOnThisSend = true
        }

        conversationIdRef.current = conversationId

        let uploadedPaths: string[] = []
        if (typeof message !== "string" && message.files?.length) {
          uploadedPaths = await uploadDraftFiles(conversationId, message.files)
        }

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

        const filesMeta =
          uploadedPaths.length > 0
            ? uploadedPaths.map((p) => ({
                path: p,
                name: p.split("/").pop() ?? p,
              }))
            : undefined
        const pendingMeta = {
          ...pendingMetaBase,
          ...(filesMeta && { files: filesMeta }),
          voice: voiceMeta,
        }

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

        if (createdOnThisSend) {
          const contactId =
            selectedContactId ?? getContactId(selectedContact) ?? ""
          if (contactId) {
            void applySemanticConversationTitle({
              conversationId,
              messageText,
              contactId,
              updateTitle: updateTitleMutation.mutateAsync,
              onError: () => {
                toast.error("更新会话标题失败")
              },
            })
          }
        }

        // 群聊：后端对群消息会立刻返回派发回执（[DONE]），上面的 sendMessage
        // 很快结束、消息已落库。此时退出草稿态切到 GroupRoomView（带成员侧栏 /
        // DAG），右侧立刻显示成员；群时间线后续由 SSE 投影刷新。
        // 放在 sendMessage 之后切，避免切视图打断发送 / 触发重复发送。
        if (contact?.type === "group" && selectedContactId && conversationId) {
          useChatStore
            .getState()
            .selectConversation(selectedContactId, String(conversationId))
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
      contact,
      sendMessage,
      setSelectedConversationId,
      session,
      updateTitleMutation,
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

      // 语音消息绕过 pending 队列：队列入队项不携带 voice 载荷，
      // 走队列会静默降级为纯文本。
      const voicePayload = message.voice

      if (isBusy && !voicePayload) {
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
    () =>
      prepareDisplayMessages(
        pickMessageDisplaySource(messages, initialMessages, status)
      ),
    [messages, initialMessages, status]
  )

  return (
    <ChatPanel
      contact={contact}
      title={title ?? DEFAULT_CONVERSATION_TITLE}
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
      onAttachmentsChange={() => {}}
      onDraftSuggestionSelect={
        contact?.type === "curator" ? handleDraftSuggestionSelect : undefined
      }
      hideHeader={hideHeader}
      className={className}
      {...props}
    />
  )
}
