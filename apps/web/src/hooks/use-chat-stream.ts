import * as React from "react"
import type { UIMessage } from "ai"

import { request, getRequestHeaders } from "@/lib/request"
import { sseEventSchema, type SSEEvent } from "@/lib/chat/langchain-sse-schema"
import {
  applySSEEventToParts,
  createPartsBuilderState,
  finalizeStreamingParts,
  type PartsBuilderState,
} from "@/lib/chat/sse-parts-builder"

export type ChatStreamStatus = "ready" | "submitted" | "streaming" | "error"

export interface UseChatStreamOptions {
  id: string
  initialMessages?: UIMessage[]
  resume?: boolean
  onError?: (error: Error) => void
  onFinish?: () => void
}

export interface UseChatStreamReturn {
  messages: UIMessage[]
  setMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>
  sendMessage: (
    message: { text: string },
    options?: { body?: Record<string, unknown> }
  ) => Promise<void>
  status: ChatStreamStatus
  error: Error | undefined
  stop: () => void
}

function getEventBoundaryIndex(buffer: string) {
  const windowsBoundary = buffer.indexOf("\r\n\r\n")
  const unixBoundary = buffer.indexOf("\n\n")
  if (windowsBoundary === -1) return unixBoundary
  if (unixBoundary === -1) return windowsBoundary
  return Math.min(windowsBoundary, unixBoundary)
}

function getEventBoundaryLength(buffer: string, index: number) {
  return buffer.startsWith("\r\n\r\n", index) ? 4 : 2
}

function parseSSELines(eventText: string): string | null {
  const lines = eventText
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())

  if (lines.length === 0) return null
  return lines.join("\n")
}

export function useChatStream(options: UseChatStreamOptions): UseChatStreamReturn {
  const { id, resume, onError, onFinish } = options

  const [messages, setMessages] = React.useState<UIMessage[]>(
    options.initialMessages ?? []
  )
  const [status, setStatus] = React.useState<ChatStreamStatus>("ready")
  const [error, setError] = React.useState<Error | undefined>()

  const abortRef = React.useRef<AbortController | null>(null)
  const builderRef = React.useRef<PartsBuilderState>(createPartsBuilderState())
  const onErrorRef = React.useRef(onError)
  const onFinishRef = React.useRef(onFinish)
  onErrorRef.current = onError
  onFinishRef.current = onFinish

  const processSSEStream = React.useCallback(
    async (stream: ReadableStream<Uint8Array>) => {
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      const state = builderRef.current

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          let sepIdx = getEventBoundaryIndex(buffer)
          while (sepIdx >= 0) {
            const eventText = buffer.slice(0, sepIdx)
            buffer = buffer.slice(
              sepIdx + getEventBoundaryLength(buffer, sepIdx)
            )

            const dataStr = parseSSELines(eventText)
            if (dataStr === null) {
              sepIdx = getEventBoundaryIndex(buffer)
              continue
            }

            if (dataStr === "[DONE]") {
              setMessages((prev) => finalizeStreamingParts(prev))
              setStatus("ready")
              onFinishRef.current?.()
              return
            }

            try {
              const payload = JSON.parse(dataStr)
              const parsed = sseEventSchema.safeParse(payload)
              if (!parsed.success) {
                sepIdx = getEventBoundaryIndex(buffer)
                continue
              }

              const event = parsed.data as SSEEvent

              setMessages((prev) => {
                const lastIdx = prev.length - 1
                if (lastIdx < 0 || prev[lastIdx].role !== "assistant") {
                  return prev
                }

                const currentParts = prev[lastIdx].parts
                const result = applySSEEventToParts(
                  currentParts,
                  event,
                  state
                )

                if (!result) return prev

                if (result.parts === currentParts) return prev

                const updated = [...prev]
                updated[lastIdx] = { ...updated[lastIdx], parts: result.parts }
                return updated
              })
            } catch {
              // skip malformed events
            }

            sepIdx = getEventBoundaryIndex(buffer)
          }
        }

        setMessages((prev) => finalizeStreamingParts(prev))
        setStatus("ready")
        onFinishRef.current?.()
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        const e = err instanceof Error ? err : new Error(String(err))
        setError(e)
        setStatus("error")
        onErrorRef.current?.(e)
      } finally {
        reader.releaseLock()
      }
    },
    []
  )

  const sendMessage = React.useCallback(
    async (
      message: { text: string },
      sendOptions?: { body?: Record<string, unknown> }
    ) => {
      const body = sendOptions?.body ?? {}
      const conversationId = body.conversationId
      const skill = body.skill ?? ""
      const metadata = body.metadata

      if (!conversationId || !message.text?.trim()) {
        throw new Error("缺少会话 ID 或消息内容")
      }

      const userMsg: UIMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        parts: [{ type: "text" as const, text: message.text, state: "done" as const }],
      }
      if (metadata) {
        ;(userMsg as UIMessage & { metadata?: unknown }).metadata = metadata
      }

      const assistantMsg: UIMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        parts: [],
      }

      setMessages((prev) => [...prev, userMsg, assistantMsg])
      setStatus("submitted")

      builderRef.current = createPartsBuilderState()

      const ac = new AbortController()
      abortRef.current = ac

      try {
        const response = await request.raw(
          `/chat/conversations/${conversationId}/stream`,
          {
            method: "POST",
            body: JSON.stringify({
              question: message.text,
              skill,
              extra_meta: metadata,
            }),
            signal: ac.signal,
          }
        )

        if (!response.ok) {
          throw new Error(`聊天请求失败 (${response.status})`)
        }
        if (!response.body) {
          throw new Error("聊天响应为空")
        }

        setStatus("streaming")
        await processSSEStream(response.body)
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        const e = err instanceof Error ? err : new Error(String(err))
        setError(e)
        setStatus("error")
        onErrorRef.current?.(e)
      }
    },
    [processSSEStream]
  )

  const stop = React.useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setMessages((prev) => finalizeStreamingParts(prev))
    setStatus("ready")
  }, [])

  React.useEffect(() => {
    if (!resume || !id) return

    let cancelled = false

    const resumeStream = async () => {
      try {
        const response = await request.raw(
          `/chat/conversations/${id}/stream/resume`,
          {
            method: "GET",
            headers: getRequestHeaders({ Accept: "text/event-stream" }),
          }
        )
        if (cancelled) return
        if (response.status === 204) return
        if (!response.ok || !response.body) return

        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1]
          if (lastMsg?.role === "assistant") return prev
          return [
            ...prev,
            {
              id: `assistant-resume-${Date.now()}`,
              role: "assistant" as const,
              parts: [],
            },
          ]
        })

        builderRef.current = createPartsBuilderState()
        setStatus("streaming")
        await processSSEStream(response.body)
      } catch {
        // silent
      }
    }

    resumeStream()
    return () => {
      cancelled = true
    }
  }, [id, resume, processSSEStream])

  React.useEffect(() => {
    if (options.initialMessages && options.initialMessages.length > 0) {
      setMessages(options.initialMessages)
      setStatus("ready")
      setError(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  return {
    messages,
    setMessages,
    sendMessage,
    status,
    error,
    stop,
  }
}


