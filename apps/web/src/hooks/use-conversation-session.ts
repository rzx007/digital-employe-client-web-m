/**

 * 单会话运行时：把 React Query 里的历史（storedMessages）同步进 useChat，

 * 并在切回会话 / 流结束时 hydrate、GET /messages，决定是否 GET /stream/resume。

 *

 * HITL 审批 id：见 ActiveHitl（interrupt SSE / DB seed），与 UIMessage.id 解耦。

 */

import { useCallback, useEffect, useRef, useState } from "react"

import type { QueryClient } from "@tanstack/react-query"

import type { UIMessage } from "ai"

import type { Message } from "@/types/chat"

import { conversationRuntimeBus } from "@/lib/chat/conversation-runtime-bus"
import { refetchRecentContacts, touchRecentContactById } from "@/lib/chat/touch-recent-contact"

import {
  createApprovedAtTimestamp,
  findPendingHitl,
  parseDbMessageId,
  patchApprovedAtOnComposerMessages,
  patchApprovedAtOnMessagesCache,
  patchAssistantWithInterruptParts,
  resolveActiveHitl,
  seedActiveHitlFromMessageParts,
  type ActiveHitl,
  type HitlPatchOptions,
} from "@/lib/chat/hitl"

import {
  getLastAssistantMessage,
  patchLastAssistantStreamState,
} from "@/lib/chat/message-query-cache"

import { chatTransport } from "@/components/chat/shared/chat-view-shared"

import { chatKeys } from "@/lib/query-keys/chat"

import { useChatStore } from "@/stores/chat-store"

import { mapStoredMessagesToUIMessages } from "@/lib/chat/message-utils"

import {
  hydrateSignature,
  messagesNeedHydrateFromDb,
} from "@/lib/chat/pick-message-display-source"

const REFETCH_DEBOUNCE_MS = 800

function terminalToStreamState(status: string): string {
  if (status === "no_stream") return "error"

  return status
}

function seedActiveHitlFromStoredMessages(
  storedMessages: Message[]
): ActiveHitl | null {
  for (let i = storedMessages.length - 1; i >= 0; i--) {
    const row = storedMessages[i]

    if (row.role !== "assistant" || row.streamState !== "interrupted") continue

    if (
      typeof row.metadata?.approved_at === "string" &&
      row.metadata.approved_at.length > 0
    ) {
      continue
    }

    const dbId = parseDbMessageId(row.id)

    if (!dbId || !row.messageParts?.length) continue

    const seeded = seedActiveHitlFromMessageParts(dbId, row.messageParts)

    if (seeded) return seeded
  }

  return null
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
  const [activeHitl, setActiveHitl] = useState<ActiveHitl | null>(null)

  const pendingHitl = findPendingHitl(composerMessages)

  const hitlInterrupted = activeHitl !== null

  const resumeAttemptedForRef = useRef<string | null>(null)

  const activeSessionRef = useRef<boolean>(false)

  const hydratedConvIdRef = useRef<string | null>(null)

  const hitlActiveRef = useRef(false)

  const prevConversationIdRef = useRef(conversationId)

  const lastHydratedSigRef = useRef<string>("")

  const composerMessagesRef = useRef(composerMessages)

  composerMessagesRef.current = composerMessages

  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const convKey = conversationId != null ? String(conversationId) : null

  useEffect(() => {
    hitlActiveRef.current = hitlInterrupted || activeHitl !== null
  }, [hitlInterrupted, activeHitl])

  useEffect(() => {
    if (prevConversationIdRef.current !== conversationId) {
      resumeAttemptedForRef.current = null

      prevConversationIdRef.current = conversationId

      hydratedConvIdRef.current = null

      lastHydratedSigRef.current = ""

      activeSessionRef.current = false

      setActiveHitl(null)

      if (convKey) {
        void queryClient.invalidateQueries({
          queryKey: chatKeys.messages(convKey),
        })
      }
    }
  }, [conversationId, convKey, queryClient])

  useEffect(() => {
    if (!convKey || activeSessionRef.current) return

    const seeded = seedActiveHitlFromStoredMessages(storedMessages)

    setActiveHitl(seeded)
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

  const resetResumeAttempt = useCallback(() => {
    resumeAttemptedForRef.current = null
  }, [])

  useEffect(() => {
    if (!convKey) return

    if (status === "streaming" || status === "submitted") {
      activeSessionRef.current = true

      return
    }

    if (initialMessages.length === 0 && storedMessages.length === 0) return

    const sig = hydrateSignature(initialMessages)
    const needsHydrate = messagesNeedHydrateFromDb(
      composerMessagesRef.current,
      initialMessages
    )
    const alreadySynced =
      hydratedConvIdRef.current === convKey &&
      lastHydratedSigRef.current === sig &&
      !needsHydrate

    if (!alreadySynced) {
      const blockedByActiveSession =
        activeSessionRef.current &&
        hydratedConvIdRef.current === convKey &&
        !needsHydrate

      if (!blockedByActiveSession) {
        setMessages(initialMessages)
        lastHydratedSigRef.current = sig
        hydratedConvIdRef.current = convKey
      }
    }

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

  }, [
    convKey,

    conversationId,

    initialMessages,

    storedMessages,

    setMessages,

    resumeStream,

    status,
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

          if (hitl) setActiveHitl(hitl)

          return next
        })

        scheduleMessagesRefetch()
      },

      onTerminal: (info) => {
        if (info.status === "cancelled") {
          activeSessionRef.current = false
          hydratedConvIdRef.current = null
        }

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

    const selectedContactId = useChatStore.getState().selectedContactId
    if (selectedContactId) {
      void touchRecentContactById(selectedContactId)
    } else {
      void refetchRecentContacts()
    }
  }, [convKey, queryClient, scheduleMessagesRefetch])

  const onStreamStopped = useCallback(() => {
    if (!convKey) return

    activeSessionRef.current = false
    hydratedConvIdRef.current = null

    patchLastAssistantStreamState(queryClient, convKey, "cancelled")

    const cached = queryClient.getQueryData<Message[]>(
      chatKeys.messages(convKey)
    )
    if (cached?.length) {
      setMessages(mapStoredMessagesToUIMessages(cached))
      hydratedConvIdRef.current = convKey
    }

    if (refetchTimerRef.current) {
      clearTimeout(refetchTimerRef.current)
      refetchTimerRef.current = null
    }

    void queryClient.invalidateQueries({
      queryKey: chatKeys.messages(convKey),
    })
  }, [convKey, queryClient, setMessages])

  const onHitlApproved = useCallback(
    async (options?: HitlPatchOptions) => {
      if (!convKey) return

      activeSessionRef.current = true

      const approvedMessageId =
        options?.approvedMessageId ?? activeHitl?.dbMessageId ?? null

      const toolCallId =
        options?.toolCallId ?? activeHitl?.toolCallId ?? undefined

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

        hitlActiveRef.current = false
      }

      setActiveHitl(null)

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

    [
      activeHitl,

      convKey,

      queryClient,

      resumeStream,

      scheduleMessagesRefetch,

      setMessages,
    ]
  )

  const prepareOutboundMessage = useCallback(() => {
    activeSessionRef.current = true

    setActiveHitl(null)

    resetResumeAttempt()
  }, [resetResumeAttempt])

  return {
    activeHitl,

    /** POST /approve 用 DB message_id（= activeHitl.dbMessageId） */

    hitlMessageId: activeHitl?.dbMessageId ?? null,

    hitlInterrupted,

    onHitlApproved,

    onStreamFinish,

    onStreamStopped,

    prepareOutboundMessage,
  }
}
