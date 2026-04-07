import {
  createIdGenerator,
  type ChatTransport,
  type UIMessage,
  type UIMessageChunk,
} from "ai"

import { request, getRequestHeaders } from "@/lib/request"

const generatePartId = createIdGenerator({
  prefix: "lc-part",
  size: 16,
})

interface LangChainAIMessageChunk {
  id?: string[]
  type?: string
  kwargs?: {
    content?: unknown
    type?: string
    chunk_position?: string
    response_metadata?: {
      finish_reason?: string
    }
  }
}

function extractAssistantText(payload: unknown) {
  if (!Array.isArray(payload) || payload.length === 0) {
    return null
  }

  const chunk = payload[0] as LangChainAIMessageChunk
  const isAiMessageChunk =
    Array.isArray(chunk.id) &&
    chunk.id.join(".") === "langchain.schema.messages.AIMessageChunk" &&
    chunk.type === "constructor" &&
    chunk.kwargs?.type === "AIMessageChunk"

  if (!isAiMessageChunk) {
    return null
  }

  const content = chunk.kwargs?.content

  if (typeof content !== "string" || content.length === 0) {
    return null
  }

  return content
}

function getEventBoundaryIndex(buffer: string) {
  const windowsBoundary = buffer.indexOf("\r\n\r\n")
  const unixBoundary = buffer.indexOf("\n\n")

  if (windowsBoundary === -1) {
    return unixBoundary
  }

  if (unixBoundary === -1) {
    return windowsBoundary
  }

  return Math.min(windowsBoundary, unixBoundary)
}

function getEventBoundaryLength(buffer: string, index: number) {
  return buffer.startsWith("\r\n\r\n", index) ? 4 : 2
}

function buildChatApiUrl(conversationId: string) {
  return `/digital/api/v1/text2sql/stream?id=${conversationId}`
}

async function createEventSourceResponse(options: {
  conversationId: string
  prompt: string
  abortSignal: AbortSignal | undefined
}) {
  const response = await request.raw(buildChatApiUrl(options.conversationId), {
    method: "POST",
    headers: getRequestHeaders({
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ prompt: options.prompt }),
    signal: options.abortSignal,
  })

  if (!response.ok) {
    throw new Error(`聊天请求失败 (${response.status})`)
  }

  if (!response.body) {
    throw new Error("聊天响应为空")
  }

  return response.body
}

export class LangChainChatTransport<
  UI_MESSAGE extends UIMessage,
> implements ChatTransport<UI_MESSAGE> {
  async sendMessages({
    chatId,
    messages,
    abortSignal,
  }: Parameters<ChatTransport<UI_MESSAGE>["sendMessages"]>[0]) {
    const latestMessage = messages.at(-1)
    const latestText = latestMessage?.parts
      ?.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim()

    if (!latestText) {
      throw new Error("消息内容不能为空")
    }

    const stream = await createEventSourceResponse({
      conversationId: chatId,
      prompt: latestText,
      abortSignal,
    })

    return this.processResponseStream(stream)
  }

  async reconnectToStream() {
    return null
  }

  private processResponseStream(stream: ReadableStream<Uint8Array>) {
    const decoder = new TextDecoder()
    const reader = stream.getReader()

    return new ReadableStream<UIMessageChunk>({
      async start(controller) {
        const textId = generatePartId()
        let buffer = ""

        controller.enqueue({ type: "start" })
        controller.enqueue({ type: "text-start", id: textId })

        const flushEvent = (eventText: string) => {
          const lines = eventText
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())

          if (lines.length === 0) {
            return false
          }

          const data = lines.join("\n")

          if (data === "[DONE]") {
            controller.enqueue({ type: "text-end", id: textId })
            controller.enqueue({ type: "finish", finishReason: "stop" })
            controller.close()
            return true
          }

          try {
            const payload = JSON.parse(data)
            const assistantText = extractAssistantText(payload)

            if (!assistantText) {
              return false
            }

            controller.enqueue({
              type: "text-delta",
              id: textId,
              delta: assistantText,
            })
          } catch {
            return false
          }

          return false
        }

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              break
            }

            buffer += decoder.decode(value, { stream: true })

            let separatorIndex = getEventBoundaryIndex(buffer)

            while (separatorIndex >= 0) {
              const eventText = buffer.slice(0, separatorIndex)
              buffer = buffer.slice(
                separatorIndex + getEventBoundaryLength(buffer, separatorIndex)
              )

              const didFinish = flushEvent(eventText)
              if (didFinish) {
                return
              }

              separatorIndex = getEventBoundaryIndex(buffer)
            }
          }

          if (buffer.trim()) {
            flushEvent(buffer)
          }

          controller.enqueue({ type: "text-end", id: textId })
          controller.enqueue({ type: "finish", finishReason: "stop" })
          controller.close()
        } catch (error) {
          controller.enqueue({
            type: "error",
            errorText:
              error instanceof Error ? error.message : "流式响应解析失败",
          })
          controller.error(error)
        } finally {
          reader.releaseLock()
        }
      },
      cancel() {
        return reader.cancel()
      },
    })
  }
}
