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
import { shouldAttemptResume } from "@/lib/chat/session/resume-decision"
import { decideHydration } from "@/lib/chat/session/hydrate-decision"

import { chatTransport } from "@/components/chat/shared/chat-view-shared"

import { chatKeys } from "@/lib/query-keys/chat"


import {
  hydrateSignature,
  messagesNeedHydrateFromDb,
  patchComposerFromStoredWhenSameTurn,
} from "@/lib/chat/pick-message-display-source"

const REFETCH_DEBOUNCE_MS = 800

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

  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const convKey = conversationId != null ? String(conversationId) : null

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
    if (!convKey || machine.active) return

    dispatch({
      type: "SEED_HITL",
      hitl: seedActiveHitlFromStoredMessages(storedMessages),
    })
  }, [convKey, machine.active, storedMessages])

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

  useEffect(() => {
    if (!convKey) return

    if (status === "streaming" || status === "submitted") {
      dispatch({ type: "ACTIVATED" })

      return
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
      active: machine.active,
      hydratedConvId: machine.hydratedConvId,
      lastHydratedSig: machine.lastHydratedSig,
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

    const willResume = shouldAttemptResume({
      hitlActive: machine.activeHitl !== null,
      lastAssistantStreamState: lastAssistant?.streamState,
      lastAssistantId: lastAssistant?.id,
      resumeAttemptedFor: machine.resumeAttemptedFor,
    })

    if (!willResume) return

    dispatch({ type: "RESUME_ATTEMPTED", assistantId: lastAssistant!.id })

    chatTransport.setResumeConversationId(convKey)

    const rafId = requestAnimationFrame(() => {
      if (status !== "ready" && status !== "error") return

      resumeStream()
    })

    return () => cancelAnimationFrame(rafId)

  }, [
    convKey,

    conversationId,

    initialMessages,

    storedMessages,

    setMessages,

    resumeStream,

    status,

    machine.active,

    machine.activeHitl,

    machine.hydratedConvId,

    machine.lastHydratedSig,

    machine.resumeAttemptedFor,
  ])

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
  }, [convKey, queryClient, scheduleMessagesRefetch, setMessages])

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
  }
}
