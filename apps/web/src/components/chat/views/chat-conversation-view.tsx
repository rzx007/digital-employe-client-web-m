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
  extractClarifyInputFromMessageParts,
  type ActiveHitl,
} from "@/lib/chat/hitl"
import { resolveGroupClarifyTarget } from "@/lib/chat/hitl/group-clarify-target"

import { chatKeys } from "@/lib/query-keys/chat"
import { pickMessageDisplaySource } from "@/lib/chat/pick-message-display-source"
import { stripGhostComposerAssistants } from "@/lib/chat/group-composer-ghosts"
import {
  isLeaderClarifyResolvedInTimeline,
  resolveGroupActiveHitlFromTimeline,
} from "@/lib/chat/hitl"
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

function groupClarifyDismissStorageKey(conversationId: string | number) {
  return `group-clarify-dismissed:${conversationId}`
}

function loadDismissedGroupClarifyIds(
  conversationId: string | number
): Set<string> {
  try {
    const raw = sessionStorage.getItem(
      groupClarifyDismissStorageKey(conversationId)
    )
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((x) => typeof x === "string"))
  } catch {
    return new Set()
  }
}

function saveDismissedGroupClarifyIds(
  conversationId: string | number,
  ids: Set<string>
) {
  try {
    sessionStorage.setItem(
      groupClarifyDismissStorageKey(conversationId),
      JSON.stringify([...ids])
    )
  } catch {
    // ignore quota / private mode
  }
}

export function ConversationChatView({
  contact,

  title,

  conversationId,

  onOpenContacts,

  onOpenConversations,

  onNewConversation,

  extraStreamingMessages,

  groupRoomBusy = false,

  onGroupRoomStop,

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

  /** 群协作：组长/成员正在执行（与 useChat status 独立，用于显示停止按钮） */
  groupRoomBusy?: boolean

  /** 群协作：停止组长/成员流式输出 */
  onGroupRoomStop?: () => void | Promise<void>
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
  const dismissedGroupClarifyRef = useRef(
    loadDismissedGroupClarifyIds(conversationId)
  )
  const [dismissedGroupClarifyTick, setDismissedGroupClarifyTick] = useState(0)

  useEffect(() => {
    dismissedGroupClarifyRef.current =
      loadDismissedGroupClarifyIds(conversationId)
    setDismissedGroupClarifyTick((t) => t + 1)
  }, [conversationId])

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

  useEffect(() => {
    if (contact?.type !== "group" || !initialMessages.length) return
    let changed = false
    for (const msg of initialMessages) {
      if (msg.role !== "assistant") continue
      const meta = (msg as { metadata?: Record<string, unknown> }).metadata
      const leaderId = parseDbMessageId(
        meta?.clarify_message_id as string | number | undefined
      )
      if (!leaderId) continue
      if (!isLeaderClarifyResolvedInTimeline(initialMessages, leaderId)) {
        continue
      }
      if (!dismissedGroupClarifyRef.current.has(leaderId)) {
        dismissedGroupClarifyRef.current.add(leaderId)
        changed = true
      }
    }
    if (changed) {
      saveDismissedGroupClarifyIds(
        conversationId,
        dismissedGroupClarifyRef.current
      )
      setDismissedGroupClarifyTick((t) => t + 1)
    }
  }, [contact?.type, conversationId, initialMessages])

  // 群会话：从已落库的消息检测待处理的 HITL 投影卡片（组长澄清/大纲等）
  const groupActiveHitl = useMemo((): ActiveHitl | null => {
    if (contact?.type !== "group" || !initialMessages?.length) return null
    return resolveGroupActiveHitlFromTimeline(
      initialMessages,
      dismissedGroupClarifyRef.current
    )
  }, [contact?.type, initialMessages, dismissedGroupClarifyTick])

  const groupClarifyInput = useMemo((): Record<string, unknown> | undefined => {
    if (contact?.type !== "group" || !groupActiveHitl || !initialMessages.length) {
      return undefined
    }
    for (let i = initialMessages.length - 1; i >= 0; i--) {
      const msg = initialMessages[i]
      if (msg.role !== "assistant") continue
      const meta = (msg as { metadata?: Record<string, unknown> }).metadata
      const target = resolveGroupClarifyTarget(meta)
      if (!target || meta?.approved_at) continue
      if (parseDbMessageId(target.messageId) !== groupActiveHitl.dbMessageId) {
        continue
      }
      const fromParts = extractClarifyInputFromMessageParts(msg.parts)
      if (Object.keys(fromParts).length > 0) return fromParts
    }
    const hitlInput = groupActiveHitl.input
    return hitlInput != null && typeof hitlInput === "object"
      ? (hitlInput as Record<string, unknown>)
      : undefined
  }, [contact?.type, groupActiveHitl, initialMessages])

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
  // 群深链进成员执行会话：独立 key 重挂清空了本地流式内容，DB 又拿不到「正在流式但
  // 未落库」的尾部 → 需 resume 从后端 buffer 拉回实时逐字。
  //
  // 触发条件按「未接上流」把关，而非「只试一次」：
  // - 已 streaming/submitted（resume 已接上）→ 跳过。否则 storedMessages 随 DB
  //   refetch/兜底轮询/resume 回写反复变更，会反复 cancelReconnect + 清空末尾气泡再从
  //   seq 0 重放 → 「一直闪屏」（这是本来的症状）。
  // - 反之（ready/error 且 DB 仍 streaming）→ kick 一次 resume。这样首次 resume 若
  //   竞争失败/被打断，后续 storedMessages 变化（4s 兜底轮询驱动）会再续，不会出现
  //   「来回切几次后流彻底没了」。续流的重试上限由 resumeAttempts 计数兜底。
  useEffect(() => {
    if (isMessagesLoading) return
    if (!isGroupDeepLinkExecutionView(groupNavReturn, conversationId)) return
    if (status === "streaming" || status === "submitted") return
    const last = getLastAssistantMessage(storedMessages)
    if (last?.streamState === "streaming") {
      retryResume()
    }
  }, [
    conversationId,
    groupNavReturn,
    isMessagesLoading,
    status,
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

    const chatWasBusy = status === "submitted" || status === "streaming"

    if (contact?.type === "group" && groupRoomBusy) {
      try {
        await onGroupRoomStop?.()
      } catch {
        toast.error("停止失败")
        return
      }
    } else if (chatWasBusy) {
      try {
        await cancelConversationStream(conversationId)
      } catch {
        toast.error("停止对话失败")
        return
      }
    }

    session.onStreamStopped()
  }, [
    contact?.type,
    conversationId,
    groupRoomBusy,
    onGroupRoomStop,
    session,
    status,
    stop,
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
      const leaderMsgId =
        options?.approvedMessageId ?? groupActiveHitl?.dbMessageId ?? null
      const leaderId = leaderMsgId != null ? parseDbMessageId(leaderMsgId) : null
      if (leaderId) {
        dismissedGroupClarifyRef.current.add(leaderId)
        saveDismissedGroupClarifyIds(
          conversationId,
          dismissedGroupClarifyRef.current
        )
        setDismissedGroupClarifyTick((t) => t + 1)
      }

      const remoteLeaderConv = groupActiveHitl?.conversationIdOverride
      const isRemoteGroupHitl =
        remoteLeaderConv != null &&
        String(remoteLeaderConv) !== String(conversationId)
      session.onHitlApproved({
        ...options,
        skipLocalResume: isRemoteGroupHitl || options?.skipLocalResume,
      })
      if (isRemoteGroupHitl || contact?.type === "group") {
        void queryClient.invalidateQueries({
          queryKey: chatKeys.messages(String(conversationId)),
        })
        void queryClient.invalidateQueries({
          queryKey: chatKeys.groupRoom(String(conversationId)),
        })
      }
    },
    [
      contact?.type,
      conversationId,
      groupActiveHitl?.conversationIdOverride,
      groupActiveHitl?.dbMessageId,
      queryClient,
      session.onHitlApproved,
    ]
  )

  const handleTextChange = useCallback((event: PromptChangeEvent) => {
    setCommand(event.command)

    setMentions(event.mentions)

    setInputValue(event.value)
  }, [])

  const isChatBusy = status === "submitted" || status === "streaming"
  const isBusy = isChatBusy || groupRoomBusy

  const chatStatus =
    status === "ready" && isBusy
      ? groupRoomBusy
        ? "streaming"
        : "submitted"
      : status

  const isSubmitDisabled = useMemo(() => {
    if (isBusy) {
      return false
    }
    return !inputValue.trim()
  }, [inputValue, isBusy])

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
      groupClarifyInput={groupClarifyInput}
      onHitlApproved={handleHitlApproved}
      className={className}
      {...props}
    />
  )
}
