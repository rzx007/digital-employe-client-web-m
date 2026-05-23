import { useCallback, useEffect, useRef, useState } from "react"
import type { QueryClient } from "@tanstack/react-query"
import type { UIMessage } from "ai"

import type { Message } from "@/lib/mock-data/messages"
import { conversationRuntimeBus } from "@/lib/chat/conversation-runtime-bus"
import type { HitlPayload } from "@/lib/chat/conversation-runtime-types"
import {
  getLastAssistantMessage,
  patchLastAssistantStreamState,
} from "@/lib/chat/message-query-cache"
import { chatTransport } from "@/components/chat/shared/chat-view-shared"
import { chatKeys } from "@/lib/query-keys/chat"
import { extractInterruptStateFromStoredMessages } from "@/lib/chat/stored-message-hitl-utils"

const REFETCH_DEBOUNCE_MS = 800

function terminalToStreamState(status: string): string {
  if (status === "no_stream") return "error"
  return status
}

export function useConversationSession({
  conversationId,
  storedMessages,
  initialMessages,
  status,
  setMessages,
  resumeStream,
  queryClient,
}: {
  conversationId: string | number | null
  storedMessages: Message[]
  initialMessages: UIMessage[]
  status: string
  setMessages: (
    messages: UIMessage[] | ((prev: UIMessage[]) => UIMessage[])
  ) => void
  resumeStream: () => void
  queryClient: QueryClient
}) {
  const [streamId, setStreamId] = useState<string | null>(null)
  const [hitlPayload, setHitlPayload] = useState<HitlPayload | null>(null)
  const hitlInterrupted = hitlPayload !== null

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

  const clearHitl = useCallback(() => {
    setHitlPayload(null)
    setStreamId(null)
  }, [])

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

  const restoreHitlFromStoredMessages = useCallback(() => {
    const stored = extractInterruptStateFromStoredMessages(storedMessages)
    if (!stored) return
    setHitlPayload(stored.hitlPayload)
    if (stored.streamId) setStreamId(stored.streamId)
  }, [storedMessages])

  const hydrateFromServer = useCallback(() => {
    if (!convKey) return
    setMessages(initialMessages)
    restoreHitlFromStoredMessages()
    hydratedConvRef.current = convKey
    resumeAttemptedForRef.current = null
    tryResumeOnce()
  }, [
    convKey,
    initialMessages,
    restoreHitlFromStoredMessages,
    setMessages,
    tryResumeOnce,
  ])

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
      onStreamId: (id) => {
        setStreamId(id)
      },
      onInterrupted: (payload) => {
        if (payload.stream_id) setStreamId(payload.stream_id)
        setHitlPayload({
          action_requests: payload.action_requests,
          review_configs: payload.review_configs,
        })
        patchLastAssistantStreamState(queryClient, convKey, "interrupted")
        scheduleMessagesRefetch()
      },
      onTerminal: (info) => {
        const streamState = terminalToStreamState(info.status)
        patchLastAssistantStreamState(queryClient, convKey, streamState)

        if (info.status === "interrupted" && info.interrupt_payload) {
          if (info.stream_id) setStreamId(info.stream_id)
          setHitlPayload({
            action_requests: info.interrupt_payload.action_requests,
            review_configs: info.interrupt_payload.review_configs,
          })
        }

        if (info.status !== "interrupted") {
          setHitlPayload(null)
        }

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
  }, [convKey, queryClient, scheduleMessagesRefetch])

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
    async (options?: { resumed?: boolean }) => {
      if (!convKey) return
      scheduleMessagesRefetch()
      if (options?.resumed === false) return
      setHitlPayload(null)
      chatTransport.setResumeConversationId(convKey)
      requestAnimationFrame(() => {
        resumeStream()
      })
    },
    [convKey, resumeStream, scheduleMessagesRefetch]
  )

  const prepareOutboundMessage = useCallback(() => {
    clearHitl()
    resetResumeAttempt()
  }, [clearHitl, resetResumeAttempt])

  return {
    streamId,
    hitlPayload,
    hitlInterrupted,
    onHitlApproved,
    onStreamFinish,
    prepareOutboundMessage,
    clearHitl,
  }
}
