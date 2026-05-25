/**
 * 单会话运行时：把 React Query 里的历史（storedMessages）同步进 useChat，
 * 并在切回会话 / SSE 终态时决定是否 GET /stream/resume。
 *
 * 与展示层分工：
 * - composerMessages：useChat 实时列表（审批 message_id、Dock 扫描 pending）
 * - storedMessages / initialMessages：来自 useMessagesQuery（refetchOnMount 拉 DB）
 *
 * Resume 规则（以 DB 最后一条 assistant 为准）：
 * - stream_state === "streaming" → resume，接上后台仍在跑的 task
 * - stream_state === "interrupted" → 不在此自动 resume；展示靠 message_parts，
 *   用户 approve 后走 onHitlApproved → resume
 *
 * 切走会话时视图卸载只会 stop() 断本端 SSE，不调 /stream/cancel，后台 _run_agent_background 可继续。
 */

import { useCallback, useEffect, useRef } from "react"
import type { QueryClient } from "@tanstack/react-query"
import type { UIMessage } from "ai"

import type { Message } from "@/types/chat"
import { conversationRuntimeBus } from "@/lib/chat/conversation-runtime-bus"
import {
  findPendingHitl,
  patchAssistantWithInterruptParts,
} from "@/lib/chat/hitl"
import {
  getLastAssistantMessage,
  patchLastAssistantStreamState,
} from "@/lib/chat/message-query-cache"
import { chatTransport } from "@/components/chat/shared/chat-view-shared"
import { chatKeys } from "@/lib/query-keys/chat"

/** 流结束后合并刷消息列表，避免 interrupt/terminal 连发多次 invalidate */
const REFETCH_DEBOUNCE_MS = 800

function terminalToStreamState(status: string): string {
  if (status === "no_stream") return "error"
  return status
}

export function useConversationSession({
  conversationId,
  storedMessages,
  initialMessages,
  composerMessages,
  status,
  setMessages,
  resumeStream,
  queryClient,
}: {
  conversationId: string | number | null
  /** useMessagesQuery 返回的 DB 行（含 stream_state / message_parts） */
  storedMessages: Message[]
  /** mapStoredMessagesToUIMessages(storedMessages) */
  initialMessages: UIMessage[]
  /** useChat.messages，未 merge 的 composer 列表 */
  composerMessages: UIMessage[]
  status: string
  setMessages: (
    messages: UIMessage[] | ((prev: UIMessage[]) => UIMessage[])
  ) => void
  resumeStream: () => void
  queryClient: QueryClient
}) {
  const pendingHitl = findPendingHitl(composerMessages)
  const hitlInterrupted = pendingHitl !== null
  const hitlMessageId = pendingHitl?.messageId ?? null

  /** 已对某条 assistant 行尝试过 resume，避免重复 GET /stream/resume */
  const resumeAttemptedForRef = useRef<string | null>(null)
  /** 与 hitlInterrupted 同步，供 resume effect 内读取（避免闭包陈旧） */
  const hitlActiveRef = useRef(false)
  const prevConversationIdRef = useRef(conversationId)
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const convKey = conversationId != null ? String(conversationId) : null

  useEffect(() => {
    hitlActiveRef.current = hitlInterrupted
  }, [hitlInterrupted])

  // 切换 conversationId 时允许对新会话再次 resume
  useEffect(() => {
    if (prevConversationIdRef.current !== conversationId) {
      resumeAttemptedForRef.current = null
      prevConversationIdRef.current = conversationId
    }
  }, [conversationId])

  const scheduleMessagesRefetch = useCallback(() => {
    if (!convKey) return
    if (refetchTimerRef.current) {
      clearTimeout(refetchTimerRef.current)
    }
    refetchTimerRef.current = setTimeout(() => {
      refetchTimerRef.current = null
      void queryClient.invalidateQueries({
        queryKey: chatKeys.messages(convKey),
      })
    }, REFETCH_DEBOUNCE_MS)
  }, [convKey, queryClient])

  const resetResumeAttempt = useCallback(() => {
    resumeAttemptedForRef.current = null
  }, [])

  /**
   * DB → useChat 同步，并在需要时恢复 SSE。
   * 依赖 storedMessages：useMessagesQuery refetch 完成后会再次执行（避免只用创建时的空缓存）。
   */
  useEffect(() => {
    if (!convKey) return
    // 本端已在拉流时不要覆盖 useChat 累积的 parts
    if (status === "streaming" || status === "submitted") return
    // 尚无 DB 数据时等待 refetch（不提前 hydrate 空列表并锁死）
    if (initialMessages.length === 0 && storedMessages.length === 0) return

    setMessages(initialMessages)

    // HITL 待办：只展示 DB/composer 中的 pending part，不接 live buffer
    if (hitlActiveRef.current) return

    const lastAssistant = getLastAssistantMessage(storedMessages)
    if (lastAssistant?.streamState !== "streaming") return
    if (resumeAttemptedForRef.current === lastAssistant.id) return

    resumeAttemptedForRef.current = lastAssistant.id
    chatTransport.setResumeConversationId(convKey)
    const rafId = requestAnimationFrame(() => {
      if (status !== "ready" && status !== "error") return
      resumeStream()
    })
    return () => cancelAnimationFrame(rafId)
    // status 仅作 rAF 回调时的防护，不加入 deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    convKey,
    conversationId,
    initialMessages,
    storedMessages,
    setMessages,
    resumeStream,
  ])

  /** 订阅 LangChainChatTransport 经 bus 抛出的 interrupt / 终态（与当前 conv 同 key） */
  useEffect(() => {
    if (!convKey) return

    const unsubscribe = conversationRuntimeBus.subscribe(convKey, {
      onInterrupted: (payload) => {
        patchLastAssistantStreamState(queryClient, convKey, "interrupted")
        if (payload.message_parts) {
          setMessages((prev) => patchAssistantWithInterruptParts(prev, payload))
        }
        scheduleMessagesRefetch()
      },
      onTerminal: (info) => {
        const streamState = terminalToStreamState(info.status)
        patchLastAssistantStreamState(queryClient, convKey, streamState)
        scheduleMessagesRefetch()
      },
    })

    return () => {
      unsubscribe()
      if (refetchTimerRef.current) {
        clearTimeout(refetchTimerRef.current)
        refetchTimerRef.current = null
      }
    }
  }, [convKey, queryClient, scheduleMessagesRefetch, setMessages])

  /** useChat onFinish：乐观把 cache 里仍标 streaming 的行改为 completed，再刷列表 */
  const onStreamFinish = useCallback(() => {
    if (!convKey) return
    const cached = queryClient.getQueryData<Message[]>(
      chatKeys.messages(convKey)
    )
    const lastAssistant = cached ? getLastAssistantMessage(cached) : undefined
    if (lastAssistant?.streamState === "streaming") {
      patchLastAssistantStreamState(queryClient, convKey, "completed")
    }
    scheduleMessagesRefetch()
  }, [convKey, queryClient, scheduleMessagesRefetch])

  /**
   * POST /approve 成功后：可选追加新 assistant 占位行，再 resume 新段的 SSE。
   * interrupted 段的 resume 只应发生在这里，而不是上面的 DB 同步 effect。
   */
  const onHitlApproved = useCallback(
    async (options?: {
      resumed?: boolean
      assistantMessageId?: string | number
    }) => {
      if (!convKey) return
      scheduleMessagesRefetch()
      if (options?.resumed === false) return

      if (options?.assistantMessageId != null) {
        const newId = String(options.assistantMessageId)
        setMessages((prev) => {
          if (prev.some((m) => m.id === newId)) return prev
          return [
            ...prev,
            {
              id: newId,
              role: "assistant",
              parts: [],
            },
          ]
        })
      }

      resumeAttemptedForRef.current = null
      chatTransport.setResumeConversationId(convKey)
      requestAnimationFrame(() => {
        resumeStream()
      })
    },
    [convKey, resumeStream, scheduleMessagesRefetch, setMessages]
  )

  /** 用户新发消息前重置 resume 去重，允许新一轮 streaming 行再次 resume */
  const prepareOutboundMessage = useCallback(() => {
    resetResumeAttempt()
  }, [resetResumeAttempt])

  return {
    hitlMessageId,
    hitlInterrupted,
    onHitlApproved,
    onStreamFinish,
    prepareOutboundMessage,
  }
}
