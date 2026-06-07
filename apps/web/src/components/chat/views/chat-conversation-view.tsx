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

import type { UIMessage } from "ai"

import { mapStoredMessagesToUIMessages } from "@/lib/chat/message-utils"

import type { PromptChangeEvent } from "@/components/lexical-editor/prompt-input-textarea"

import { useMessagesQuery } from "@/hooks/use-chat-queries"

import { usePendingMessages } from "@/hooks/use-pending-messages"

import { useConversationSession } from "@/hooks/use-conversation-session"

import {
  prepareDisplayMessages,
  parseDbMessageId,
  type ActiveHitl,
} from "@/lib/chat/hitl"
import { hitlKindFromToolType } from "@/lib/chat/hitl/kind"
import { resolveGroupClarifyTarget } from "@/lib/chat/hitl/group-clarify-target"

import { chatKeys } from "@/lib/query-keys/chat"
import { pickMessageDisplaySource } from "@/lib/chat/pick-message-display-source"
import { stripGhostComposerAssistants } from "@/lib/chat/group-composer-ghosts"
import {
  isBenignStreamAbortError,
  isStreamDisconnectedError,
} from "@/lib/chat/stream-abort"

import { useSyncPendingFromComposer } from "@/hooks/use-sync-pending-from-composer"

import { ChatPanel } from "../panel/chat-panel"

import { chatTransport, type ChatViewContact } from "../shared/chat-view-shared"

import { cancelConversationStream } from "@/api/chat"
import { getContactId } from "@/lib/chat/contact-utils"
import { isGroupDeepLinkExecutionView } from "@/lib/chat/group-navigation"
import { getLastAssistantMessage } from "@/lib/chat/message-query-cache"
import { useChatStore } from "@/stores/chat-store"

import { toast } from "sonner"

export function ConversationChatView({
  contact,

  title,

  conversationId,

  onOpenContacts,

  onOpenConversations,

  onNewConversation,

  extraStreamingMessages,

  className,

  ...props
}: ComponentProps<"div"> & {
  contact?: ChatViewContact

  title: string

  conversationId: string | number

  onOpenContacts?: () => void

  onOpenConversations?: () => void

  onNewConversation?: () => void

  /** 群协作：进行中成员/组长的逐字流式临时消息，追加到时间线末尾像单聊一样逐字 */
  extraStreamingMessages?: UIMessage[]
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

  // 群会话：从已落库的消息检测待处理的 HITL 投影卡片（组长澄清/大纲等）
  const groupActiveHitl = useMemo((): ActiveHitl | null => {
    if (contact?.type !== "group" || !initialMessages?.length) return null
    for (let i = initialMessages.length - 1; i >= 0; i--) {
      const msg = initialMessages[i]
      if (msg.role !== "assistant") continue
      const meta = (msg as { metadata?: Record<string, unknown> }).metadata
      if (!meta) continue
      const target = resolveGroupClarifyTarget(meta)
      if (!target || meta.approved_at) continue
      // 找 input-available 的 HITL tool part（支持任意 submit_* 工具类型）
      const hitlPart = msg.parts?.find(
        (p) =>
          typeof p.type === "string" &&
          p.type.startsWith("tool-submit_") &&
          (p as { state?: string }).state === "input-available"
      ) as
        | {
            type: string
            toolCallId?: string
            input?: unknown
            state?: string
          }
        | undefined
      if (!hitlPart) continue
      const dbMessageId = parseDbMessageId(target.messageId)
      if (!dbMessageId) continue
      const kind = hitlKindFromToolType(hitlPart.type)
      if (!kind) continue
      return {
        dbMessageId,
        toolCallId: hitlPart.toolCallId ?? "",
        kind,
        input: (hitlPart.input ?? {}) as Record<string, unknown>,
        conversationIdOverride: target.conversationId,
      }
    }
    return null
  }, [contact?.type, initialMessages])

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

  // 群深链进成员执行会话：独立 key 重挂会清空本地流式内容，DB 又拿不到「正在
  // 流式但未落库」的部分 → 内容消失。等 messages 加载完后，若该会话正在流式
  // （DB 最后一条 assistant=streaming），强制触发一次 resume 从后端 buffer 拉回，
  // 让点进正在跑的成员会话能看到实时逐字输出。
  const groupNavReturn = useChatStore((s) => s.groupNavigationReturn)
  const retryResume = session.retryResumeIfNeeded
  useEffect(() => {
    if (isMessagesLoading) return
    if (!isGroupDeepLinkExecutionView(groupNavReturn, conversationId)) return
    const last = getLastAssistantMessage(storedMessages)
    if (last?.streamState === "streaming") {
      retryResume()
    }
    // 仅在「深链目标会话 + 消息加载完」时尝试一次；storedMessages 变化驱动重判
  }, [
    conversationId,
    groupNavReturn,
    isMessagesLoading,
    storedMessages,
    retryResume,
  ])

  useSyncPendingFromComposer(conversationId, messages, status)

  useEffect(() => {
    onStreamFinishRef.current = session.onStreamFinish
    onRetryResumeRef.current = session.retryResumeIfNeeded
  }, [session.onStreamFinish, session.retryResumeIfNeeded])

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
    let source = pickMessageDisplaySource(messages, initialMessages, status)
    if (contact?.type === "group") {
      source = stripGhostComposerAssistants(source)
    }

    const prepared = prepareDisplayMessages(source)
    // 群协作：把进行中成员/组长的逐字流式临时消息追加到时间线末尾，
    // 用与单聊完全相同的气泡逐字渲染；完成后由落库消息接管、临时消息清除。
    if (extraStreamingMessages && extraStreamingMessages.length > 0) {
      return [...prepared, ...extraStreamingMessages]
    }
    return prepared
  }, [contact?.type, initialMessages, messages, status, extraStreamingMessages])

  // 群 SSE 仅 ack+[DONE]，useChat 会留下空 assistant；流结束后清掉 composer 残留。
  useEffect(() => {
    if (contact?.type !== "group") return
    if (status !== "ready") return
    setMessages((prev) => stripGhostComposerAssistants(prev))
  }, [contact?.type, status, setMessages])

  const handleHitlApproved = useCallback(
    (options?: Parameters<typeof session.onHitlApproved>[0]) => {
      const remoteLeaderConv = groupActiveHitl?.conversationIdOverride
      const isRemoteGroupHitl =
        remoteLeaderConv != null &&
        String(remoteLeaderConv) !== String(conversationId)
      session.onHitlApproved({
        ...options,
        skipLocalResume: isRemoteGroupHitl || options?.skipLocalResume,
      })
      if (isRemoteGroupHitl) {
        void queryClient.invalidateQueries({
          queryKey: chatKeys.groupRoom(String(conversationId)),
        })
      }
    },
    [
      conversationId,
      groupActiveHitl?.conversationIdOverride,
      queryClient,
      session.onHitlApproved,
    ]
  )

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
      activeHitl={groupActiveHitl ?? session.activeHitl}
      onHitlApproved={handleHitlApproved}
      className={className}
      {...props}
    />
  )
}
