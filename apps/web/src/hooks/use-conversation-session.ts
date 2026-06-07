/**

 * 单会话运行时：把 React Query 里的历史（storedMessages）同步进 useChat，

 * 并在切回会话 / 流结束时 hydrate、GET /messages，决定是否 GET /stream/resume。

 *

 * HITL 审批 id：见 ActiveHitl（interrupt SSE / DB seed），与 UIMessage.id 解耦。

 */

import { useCallback, useEffect, useReducer, useRef } from "react"

import type { QueryClient } from "@tanstack/react-query"

import type { UIMessage } from "ai"

import type { Message } from "@/types/chat"

import { conversationRuntimeBus } from "@/lib/chat/conversation-runtime-bus"
import { refetchRecentContacts, touchRecentContactById } from "@/lib/chat/touch-recent-contact"

import {
  createApprovedAtTimestamp,
  findPendingHitl,
  patchApprovedAtOnComposerMessages,
  patchApprovedAtOnMessagesCache,
  patchAssistantWithInterruptParts,
  resolveActiveHitl,
  type HitlPatchOptions,
} from "@/lib/chat/hitl"

import {
  getLastAssistantMessage,
  patchLastAssistantStreamState,
} from "@/lib/chat/message-query-cache"

import { terminalToStreamState } from "@/lib/chat/session/terminal-state"
import { seedActiveHitlFromStoredMessages } from "@/lib/chat/session/seed-active-hitl"
import {
  initialSessionMachine,
  sessionReducer,
} from "@/lib/chat/session/session-machine"
import {
  cancelScheduledStreamResume,
  scheduleStreamResume,
  shouldAttemptResume,
} from "@/lib/chat/session/resume-decision"
import { resetLastAssistantPartsForResume } from "@/lib/chat/session/reset-assistant-parts-for-resume"
import { decideHydration } from "@/lib/chat/session/hydrate-decision"

import { chatTransport } from "@/components/chat/shared/chat-view-shared"

import { chatKeys } from "@/lib/query-keys/chat"


import {
  hydrateSignature,
  messagesNeedHydrateFromDb,
  patchComposerFromStoredWhenSameTurn,
} from "@/lib/chat/pick-message-display-source"

const REFETCH_DEBOUNCE_MS = 800

/**
 * C 兜底轮询间隔：本地 SSE 已「假结束」（status 非 streaming）但 DB 仍 streaming 时，
 * 每隔这么久拉一次 DB，让后台仍在跑的内容近实时补全。即便 SSE resume 始终续不上
 * （代理彻底掐死 SSE），用户也不必手动重进会话。DB 转终态即停轮询。
 */
const DB_STALL_POLL_INTERVAL_MS = 4000

export function useConversationSession({
  conversationId,
  contactId,

  storedMessages,

  initialMessages,

  composerMessages,

  status,

  setMessages,

  resumeStream,

  queryClient,
}: {
  conversationId: string | number | null
  /** 本会话所属联系人；流结束时 touch 最近列表，勿读全局 selectedContactId */
  contactId: string | null

  storedMessages: Message[]

  initialMessages: UIMessage[]

  composerMessages: UIMessage[]

  status: string

  setMessages: (
    messages: UIMessage[] | ((prev: UIMessage[]) => UIMessage[])
  ) => void

  resumeStream: () => void

  queryClient: QueryClient
}) {
  const [machine, dispatch] = useReducer(sessionReducer, initialSessionMachine)

  const pendingHitl = findPendingHitl(composerMessages)

  const hitlInterrupted = machine.activeHitl !== null

  const prevConversationIdRef = useRef(conversationId)

  const composerMessagesRef = useRef(composerMessages)

  composerMessagesRef.current = composerMessages

  /**
   * 非响应式镜像：effect 内读 machine 走 ref，避免本 effect 内的 dispatch
   * （RESUME_ATTEMPTED / HYDRATED 等会改 machine 簿记字段）把自己重跑、
   * 进而 cleanup 取消掉刚调度的 resume rAF。machine 仍是唯一真相源（reducer），
   * 仅 effect 的「读取」走 ref —— 复刻重构前 ref 簿记的非响应式语义。
   */
  const machineRef = useRef(machine)

  // latest-value ref（与上方 composerMessagesRef 同模式）：render 期同步赋值以保证
  // effect 内读到最新 machine；这是有意为之的非响应式读取。
  // eslint-disable-next-line react-hooks/refs
  machineRef.current = machine

  // latest-value ref：延迟 resume 回调内读「实时」status（而非调度时的快照），
  // 并让 retryResumeIfNeeded 不必依赖 status —— 否则 status 变化会重跑总线 effect、
  // 误清掉刚调度的 refetch 防抖定时器（见 use-conversation-session.test「Bug1 回归」）。
  const statusRef = useRef(status)

  // eslint-disable-next-line react-hooks/refs
  statusRef.current = status

  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resumeScheduleRef = useRef<
    ReturnType<typeof setTimeout> | number | null
  >(null)

  const convKey = conversationId != null ? String(conversationId) : null

  const tryScheduleResume = useCallback(
    (assistantId: string, options?: { allowBusyStatus?: boolean }) => {
      if (!convKey) return false

      const willResume = shouldAttemptResume({
        hitlActive: machineRef.current.activeHitl !== null,
        lastAssistantStreamState: "streaming",
        lastAssistantId: assistantId,
        resumeAttempts: machineRef.current.resumeAttempts,
      })

      if (!willResume) return false

      const attemptIndex =
        machineRef.current.resumeAttempts[assistantId] ?? 0

      dispatch({ type: "RESUME_ATTEMPTED", assistantId })

      chatTransport.setResumeConversationId(convKey)

      cancelScheduledStreamResume(resumeScheduleRef.current)
      resumeScheduleRef.current = scheduleStreamResume(() => {
        // 读「实时」status，而非调度时的快照 —— 否则退避延迟期间用户发了新消息，
        // 旧快照会误判 ready 而放行，与新发送的流撞车。
        const current = statusRef.current
        const busy = current === "submitted" || current === "streaming"
        if (busy && !options?.allowBusyStatus) return
        if (
          !options?.allowBusyStatus &&
          current !== "ready" &&
          current !== "error"
        ) {
          return
        }
        // resume = 后端从 seq 0 全量重放重建整条消息。先把末尾 assistant 清成空壳，
        // 否则重放的新 text part 会叠在断线前已渲染的旧 part 上→前缀重复（SDK 的
        // text part 不按 id upsert）。清空后重放等于「权威快照原地覆盖整条气泡」，
        // 不丢不重。同步 setMessages 后再 resumeStream，确保 SDK 读到的是空壳基底。
        setMessages(resetLastAssistantPartsForResume)
        resumeStream()
      }, attemptIndex)

      return true
    },
    [convKey, resumeStream, setMessages]
  )

  // resume 成功重新接上流（status 跃迁回 streaming）→ 重置该 turn 的 resume 计数。
  // 否则一个长 turn 多次断开会吃光 MAX_STREAM_RESUME_ATTEMPTS 配额，之后断开
  // 不再续流（R-1）。仅在「曾经发起过 resume」时重置，避免无谓 dispatch 重渲染。
  const prevStatusRef = useRef(status)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    if (status !== "streaming" || prev === "streaming") return
    if (Object.keys(machineRef.current.resumeAttempts).length === 0) return
    dispatch({ type: "RESUME_RESET" })
  }, [status])

  useEffect(() => {
    if (prevConversationIdRef.current !== conversationId) {
      prevConversationIdRef.current = conversationId

      dispatch({ type: "CONVERSATION_SWITCHED" })

      if (convKey) {
        void queryClient.invalidateQueries({
          queryKey: chatKeys.messages(convKey),
        })
      }
    }
  }, [conversationId, convKey, queryClient])

  useEffect(() => {
    if (!convKey || machineRef.current.active) return

    dispatch({
      type: "SEED_HITL",
      hitl: seedActiveHitlFromStoredMessages(storedMessages),
    })
  }, [convKey, storedMessages])

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

  // C 兜底轮询：SSE 在长执行任务里常被中间层反复掐断（用户：「SSE 经常卡没了」），
  // resume 续流不一定每次都能接上。当本地 status 已非 streaming（SSE「假结束」）但 DB
  // 最后一条 assistant 仍为 streaming（后台仍在跑）时，定时拉 DB 把内容近实时补全，
  // 不再依赖手动重进会话。一旦 DB 转终态或本地 status 回到 streaming（resume 接上了）
  // 就停轮询。与 B（SSE 续流）互补：B 续上时 status→streaming 会停掉本轮询，避免双补。
  const isLocallyStreaming = status === "streaming" || status === "submitted"
  useEffect(() => {
    if (!convKey) return
    if (isLocallyStreaming) return

    const lastAssistant = getLastAssistantMessage(storedMessages)
    if (lastAssistant?.streamState !== "streaming") return

    const timer = setInterval(() => {
      const cached = queryClient.getQueryData<Message[]>(
        chatKeys.messages(convKey)
      )
      const last = cached ? getLastAssistantMessage(cached) : undefined
      // DB 已转终态 → 不再需要兜底（effect 会随 storedMessages 变化重算并停掉）
      if (last && last.streamState !== "streaming") return
      void queryClient.invalidateQueries({
        queryKey: chatKeys.messages(convKey),
      })
    }, DB_STALL_POLL_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [convKey, isLocallyStreaming, storedMessages, queryClient])

  useEffect(() => {
    if (!convKey) return

    const hydrateFromDbIfBehind = () => {
      if (initialMessages.length === 0) return false
      const composer = composerMessagesRef.current
      if (!messagesNeedHydrateFromDb(composer, initialMessages)) {
        return false
      }
      const sig = hydrateSignature(initialMessages)
      const next =
        patchComposerFromStoredWhenSameTurn(composer, initialMessages) ??
        initialMessages
      setMessages(next)
      dispatch({ type: "HYDRATED", convKey, sig })
      return true
    }

    if (status === "streaming" || status === "submitted") {
      const wasActive = machineRef.current.active
      const lastAssistant = getLastAssistantMessage(storedMessages)
      const lastAssistantId = lastAssistant?.id
        ? String(lastAssistant.id)
        : undefined

      dispatch({ type: "ACTIVATED" })
      hydrateFromDbIfBehind()

      // 切走再切回：useChat 可能残留 streaming，但 SSE 已断 —— 需重新 resume
      if (
        lastAssistant?.streamState === "streaming" &&
        lastAssistantId &&
        !wasActive
      ) {
        tryScheduleResume(lastAssistantId, { allowBusyStatus: true })
      }

      return () => cancelScheduledStreamResume(resumeScheduleRef.current)
    }

    if (initialMessages.length === 0 && storedMessages.length === 0) return

    const sig = hydrateSignature(initialMessages)
    const needsHydrate = messagesNeedHydrateFromDb(
      composerMessagesRef.current,
      initialMessages
    )

    const decision = decideHydration({
      convKey,
      sig,
      needsHydrate,
      active: machineRef.current.active,
      hydratedConvId: machineRef.current.hydratedConvId,
      lastHydratedSig: machineRef.current.lastHydratedSig,
    })

    if (decision.action === "patch") {
      setMessages(
        patchComposerFromStoredWhenSameTurn(
          composerMessagesRef.current,
          initialMessages
        ) ?? initialMessages
      )
      dispatch({ type: "HYDRATED", convKey, sig })
    } else if (decision.action === "replace") {
      setMessages(initialMessages)
      dispatch({ type: "HYDRATED", convKey, sig })
    }

    const lastAssistant = getLastAssistantMessage(storedMessages)
    const lastAssistantId = lastAssistant?.id

    const willResume = shouldAttemptResume({
      hitlActive: machineRef.current.activeHitl !== null,
      lastAssistantStreamState: lastAssistant?.streamState ?? undefined,
      lastAssistantId,
      resumeAttempts: machineRef.current.resumeAttempts,
    })

    if (!willResume || !lastAssistantId) return

    tryScheduleResume(String(lastAssistantId))

    return () => cancelScheduledStreamResume(resumeScheduleRef.current)

    // 依赖只列外部输入：machine.* 经 machineRef 读取（非响应式），
    // 以免本 effect 内的 dispatch 触发自重跑、cleanup 取消 resume rAF。
  }, [
    convKey,

    conversationId,

    initialMessages,

    storedMessages,

    setMessages,

    resumeStream,

    status,

    tryScheduleResume,
  ])

  const retryResumeIfNeeded = useCallback((): boolean => {
    if (!convKey) return false

    const cached = queryClient.getQueryData<Message[]>(
      chatKeys.messages(convKey)
    )
    const lastAssistant = cached ? getLastAssistantMessage(cached) : undefined
    const assistantId = lastAssistant?.id ? String(lastAssistant.id) : undefined

    if (lastAssistant?.streamState !== "streaming" || !assistantId) {
      return false
    }

    // R-1：本次断流发生在「流此前已接上、正在跑」时（status 仍 streaming）——这是一次
    // 全新的、独立的掉线，而非连不上的紧凑重试链。SSE 在长执行任务里会被中间层反复掐断
    // （用户：「SSE 经常卡没了」），若沿用同一 assistant 的累计计数，几次掉线就吃光
    // MAX_STREAM_RESUME_ATTEMPTS=3 配额，之后再断永久不续 → 「基本不会回复」。故在「接上后
    // 又断」时先重置该 turn 的 resume 计数，让 3 次配额只用于拦「连不上」的死循环。
    // 仅 RESUME_RESET 这一处依赖：status 跃迁 effect（:190）只在干净的 →streaming 时重置，
    // 快速断开会漏掉，这里按「断流时仍 streaming」补一道更可靠的重置。
    if (statusRef.current === "streaming") {
      dispatch({ type: "RESUME_RESET", assistantId })
    }

    chatTransport.cancelReconnect()
    return tryScheduleResume(assistantId, { allowBusyStatus: true })
  }, [convKey, queryClient, tryScheduleResume])

  useEffect(() => {
    if (!convKey) return

    const unsubscribe = conversationRuntimeBus.subscribe(convKey, {
      onInterrupted: (payload) => {
        patchLastAssistantStreamState(queryClient, convKey, "interrupted")

        setMessages((prev) => {
          const next = payload.message_parts
            ? patchAssistantWithInterruptParts(prev, payload)
            : prev

          const hitl = resolveActiveHitl(payload, next)

          dispatch({ type: "INTERRUPTED", hitl })

          return next
        })

        scheduleMessagesRefetch()
      },

      onTerminal: (info) => {
        if (info.status === "no_stream") {
          retryResumeIfNeeded()
          scheduleMessagesRefetch()
          return
        }

        dispatch({ type: "TERMINAL", status: info.status })

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
  }, [convKey, queryClient, retryResumeIfNeeded, scheduleMessagesRefetch, setMessages])

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

    if (contactId) {
      void touchRecentContactById(contactId)
    } else {
      void refetchRecentContacts()
    }
  }, [contactId, convKey, queryClient, scheduleMessagesRefetch])

  const onStreamStopped = useCallback(() => {
    if (!convKey) return

    dispatch({ type: "STREAM_STOPPED" })

    patchLastAssistantStreamState(queryClient, convKey, "cancelled")

    if (refetchTimerRef.current) {
      clearTimeout(refetchTimerRef.current)
      refetchTimerRef.current = null
    }

    scheduleMessagesRefetch()
  }, [convKey, queryClient, scheduleMessagesRefetch])

  const onHitlApproved = useCallback(
    async (options?: HitlPatchOptions) => {
      if (!convKey) return

      const approvedMessageId =
        options?.approvedMessageId ?? machine.activeHitl?.dbMessageId ?? null

      const toolCallId =
        options?.toolCallId ?? machine.activeHitl?.toolCallId ?? undefined

      if (approvedMessageId != null) {
        const approvedAt = createApprovedAtTimestamp()

        patchApprovedAtOnMessagesCache(
          queryClient,

          convKey,

          approvedMessageId,

          approvedAt
        )

        setMessages((prev) =>
          patchApprovedAtOnComposerMessages(
            prev,

            approvedMessageId,

            approvedAt,

            toolCallId
          )
        )
      }

      dispatch({ type: "HITL_APPROVED" })

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

      dispatch({ type: "RESUME_RESET" })

      // 封存中断消息里的 HITL toolCallId：resume 时 deepagents 会重放该 AIMessage+ToolMessage，
      // 跳过其重发以免合并气泡内工具块重复（见 resume-seal 测试与 langchain-stream-parser）。
      chatTransport.setResumeSealedToolCallIds(toolCallId ? [toolCallId] : [])

      chatTransport.setResumeConversationId(convKey)

      requestAnimationFrame(() => {
        resumeStream()
      })
    },

    [
      machine.activeHitl,

      convKey,

      queryClient,

      resumeStream,

      scheduleMessagesRefetch,

      setMessages,
    ]
  )

  const prepareOutboundMessage = useCallback(() => {
    dispatch({ type: "OUTBOUND_PREPARED" })
  }, [])

  return {
    activeHitl: machine.activeHitl,

    /** POST /approve 用 DB message_id（= activeHitl.dbMessageId） */

    hitlMessageId: machine.activeHitl?.dbMessageId ?? null,

    hitlInterrupted,

    onHitlApproved,

    onStreamFinish,

    onStreamStopped,

    prepareOutboundMessage,

    retryResumeIfNeeded,
  }
}
