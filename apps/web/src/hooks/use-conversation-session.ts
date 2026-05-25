import { useCallback, useEffect, useRef } from "react"
import type { QueryClient } from "@tanstack/react-query"
import type { UIMessage } from "ai"

import type { Message } from "@/lib/mock-data/messages"
import { conversationRuntimeBus } from "@/lib/chat/conversation-runtime-bus"
import { findPendingHitl } from "@/lib/chat/hitl-abort-message-utils"
import {
  getLastAssistantMessage,
  patchLastAssistantStreamState,
} from "@/lib/chat/message-query-cache"
import { chatTransport } from "@/components/chat/shared/chat-view-shared"
import { chatKeys } from "@/lib/query-keys/chat"

const REFETCH_DEBOUNCE_MS = 800

function terminalToStreamState(status: string): string {
  if (status === "no_stream") return "error"
  return status
}

function parseMessageId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value)
  }
  if (typeof value === "string" && value.length > 0) return value
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
  const pendingHitl = findPendingHitl(composerMessages)
  const hitlInterrupted = pendingHitl !== null
  const hitlMessageId = pendingHitl?.messageId ?? null

  const hydratedConvRef = useRef<string | null>(null)
  const resumeAttemptedForRef = useRef<string | null>(null)
  const hitlActiveRef = useRef(false)
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const convKey = conversationId != null ? String(conversationId) : null

  hitlActiveRef.current = hitlInterrupted

  useEffect(() => {
    if (!convKey) {
      hydratedConvRef.current = null
      resumeAttemptedForRef.current = null
      return
    }
    if (
      hydratedConvRef.current !== null &&
      hydratedConvRef.current !== convKey
    ) {
      hydratedConvRef.current = null
      resumeAttemptedForRef.current = null
    }
  }, [convKey])

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

  const tryResumeOnce = useCallback(() => {
    if (!convKey) return
    if (status === "streaming" || status === "submitted") return
    if (hitlActiveRef.current) return

    const lastAssistant = getLastAssistantMessage(storedMessages)
    if (!lastAssistant || lastAssistant.streamState !== "streaming") return
    if (resumeAttemptedForRef.current === lastAssistant.id) return

    resumeAttemptedForRef.current = lastAssistant.id
    chatTransport.setResumeConversationId(convKey)
    requestAnimationFrame(() => {
      if (status !== "ready" && status !== "error") return
      resumeStream()
    })
  }, [convKey, resumeStream, status, storedMessages])

  const hydrateFromServer = useCallback(() => {
    if (!convKey) return
    setMessages(initialMessages)
    hydratedConvRef.current = convKey
    resumeAttemptedForRef.current = null
    tryResumeOnce()
  }, [convKey, initialMessages, setMessages, tryResumeOnce])

  useEffect(() => {
    if (!convKey) return
    if (hydratedConvRef.current === convKey) return
    if (initialMessages.length === 0 && storedMessages.length === 0) return
    hydrateFromServer()
  }, [
    convKey,
    hydrateFromServer,
    initialMessages.length,
    storedMessages.length,
  ])

  useEffect(() => {
    if (!convKey) return

    const unsubscribe = conversationRuntimeBus.subscribe(convKey, {
      onInterrupted: (payload) => {
        patchLastAssistantStreamState(queryClient, convKey, "interrupted")
        if (payload.message_parts) {
          const messageId = parseMessageId(payload.message_id)
          setMessages((prev) => {
            if (prev.length === 0) return prev
            const targetIndex =
              messageId != null
                ? prev.findIndex(
                    (m) => m.role === "assistant" && String(m.id) === messageId
                  )
                : -1
            const index =
              targetIndex >= 0
                ? targetIndex
                : prev.findLastIndex((m) => m.role === "assistant")
            if (index < 0) return prev
            const target = prev[index]
            const storedParts = payload.message_parts as UIMessage["parts"]
            const existingTypes = new Set(target.parts.map((p) => p.type))
            const newParts = storedParts.filter((p) => !existingTypes.has(p.type))
            if (newParts.length === 0) return prev
            const next = [...prev]
            next[index] = {
              ...target,
              parts: [...target.parts, ...newParts],
            }
            return next
          })
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

      chatTransport.setResumeConversationId(convKey)
      requestAnimationFrame(() => {
        resumeStream()
      })
    },
    [convKey, resumeStream, scheduleMessagesRefetch, setMessages]
  )

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
