import {
  type ChatTransport,
  type FileUIPart,
  type UIMessage,
  type UIMessageChunk,
} from "ai"

import { request, getRequestHeaders } from "@/lib/request"
import { SeeData, createMockSSEStream } from "@/lib/mock-data/sse"
import {
  closeTextPhaseIfNeeded,
  createLangChainStreamParseState,
  enqueueFinish,
  parseLangChainPayloadToChunks,
} from "./langchain-stream-parser"

const useMock =
  import.meta.env.DEV && import.meta.env.VITE_USE_MOCK_SSE === "true"

/**
 * 获取事件边界的索引位置
 * 该函数用于查找HTTP请求或响应头与正文之间的分隔边界
 * 支持Windows风格(\r\n\r\n)和Unix风格(\n\n)的换行符格式
 *
 * @param buffer - 输入的字符串缓冲区，通常包含HTTP头部信息
 * @returns 返回边界字符的位置索引，如果未找到则返回-1
 */
function getEventBoundaryIndex(buffer: string) {
  // 查找Windows风格的换行符边界（\r\n\r\n）
  const windowsBoundary = buffer.indexOf("\r\n\r\n")
  // 查找Unix风格的换行符边界（\n\n）
  const unixBoundary = buffer.indexOf("\n\n")

  if (windowsBoundary === -1) {
    return unixBoundary
  }

  if (unixBoundary === -1) {
    return windowsBoundary
  }

  // 返回较早出现的边界位置
  return Math.min(windowsBoundary, unixBoundary)
}

function getEventBoundaryLength(buffer: string, index: number) {
  return buffer.startsWith("\r\n\r\n", index) ? 4 : 2
}

function buildChatApiUrl(options: any) {
  return `/chat/conversations/${options.conversationId}/stream?question=${options.prompt}&skill=${options.skill}`
}

function buildResumeApiUrl(conversationId: string) {
  return `/digital/api/v1/text2sql/stream/resume?id=${conversationId}`
}

function getConversationIdFromBody(body: object | undefined) {
  if (!body || typeof body !== "object") {
    return null
  }

  const { conversationId } = body as { conversationId?: unknown }

  return typeof conversationId === "string" ? conversationId : null
}

function getSkillFromBody(body: any): string {
  if (!body || typeof body !== "object") {
    return ''
  }

  return body?.skill || '' 
}
function getAttachmentsFromBody(body: object | undefined) {
  if (!body || typeof body !== "object") {
    return []
  }

  const { attachments } = body as { attachments?: unknown }

  return Array.isArray(attachments)
    ? (attachments.filter(
      (attachment): attachment is FileUIPart =>
        typeof attachment === "object" &&
        attachment !== null &&
        "type" in attachment &&
        attachment.type === "file"
    ) as FileUIPart[])
    : []
}

async function createEventSourceResponse(options: {
  conversationId: string
  prompt: string
  skill: string
  abortSignal: AbortSignal | undefined
}) {
  const response = await request.raw(buildChatApiUrl(options), {
    method: "GET",
    // headers: getRequestHeaders({
    //   Accept: "text/event-stream",
    //   "Content-Type": "application/json",
    // }),
    // body: JSON.stringify({ question: options.prompt }),
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

async function createResumeEventSourceResponse(options: {
  conversationId: string
  abortSignal: AbortSignal | undefined
}) {
  const response = await request.raw(
    buildResumeApiUrl(options.conversationId),
    {
      method: "GET",
      headers: getRequestHeaders({
        Accept: "text/event-stream",
      }),
      signal: options.abortSignal,
    }
  )

  if (response.status === 204) {
    return null
  }

  if (!response.ok) {
    throw new Error(`恢复聊天请求失败 (${response.status})`)
  }

  if (!response.body) {
    throw new Error("恢复聊天响应为空")
  }

  return response.body
}

export class LangChainChatTransport<
  UI_MESSAGE extends UIMessage,
> implements ChatTransport<UI_MESSAGE> {
  async sendMessages({
    messages,
    abortSignal,
    body,
  }: Parameters<ChatTransport<UI_MESSAGE>["sendMessages"]>[0]) {
    const conversationId = getConversationIdFromBody(body)
    const skill = getSkillFromBody(body)
    const attachments = getAttachmentsFromBody(body)
    const latestMessage = messages.at(-1)
    const latestText = latestMessage?.parts
      ?.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim()

    if (!conversationId) {
      throw new Error("缺少会话 ID")
    }

    if (!latestText) {
      throw new Error("消息内容不能为空")
    }

    void attachments

    const stream = useMock
      ? createMockSSEStream(SeeData)
      : await createEventSourceResponse({
        conversationId,
        skill,
        prompt: latestText,
        abortSignal,
      })

    return this.processResponseStream(stream)
  }

  async reconnectToStream({
    chatId,
  }: Parameters<ChatTransport<UI_MESSAGE>["reconnectToStream"]>[0]) {
    if (!chatId) {
      return null
    }

    const stream = await createResumeEventSourceResponse({
      conversationId: chatId,
      abortSignal: undefined,
    })

    if (!stream) {
      return null
    }

    return this.processResponseStream(stream)
  }

  /**
   * 处理服务器发送的响应流，将其转换为UI消息块流
   * 该方法接收一个字节数组可读流，解析其中的SSE（Server-Sent Events）格式数据，
   * 并将解析后的消息块输出到新的可读流中
   *
   * @param stream - 包含Uint8Array数据的可读流，预期包含SSE格式的消息
   * @returns 返回一个可读流，产生UIMessageChunk类型的事件
   */
  private processResponseStream(stream: ReadableStream<Uint8Array>) {
    const decoder = new TextDecoder()
    const reader = stream.getReader()

    return new ReadableStream<UIMessageChunk>({
      async start(controller) {
        let buffer = ""
        const state = createLangChainStreamParseState()

        controller.enqueue({ type: "start" })

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
            closeTextPhaseIfNeeded(state).forEach((chunk) =>
              controller.enqueue(chunk)
            )
            enqueueFinish(controller, state)
            controller.close()
            return true
          }

          try {
            const payload = JSON.parse(data)
            const chunks = parseLangChainPayloadToChunks({
              payload,
              state,
            })

            chunks.forEach((chunk) => {
              console.log(chunk)
              controller.enqueue(chunk)
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

          closeTextPhaseIfNeeded(state).forEach((chunk) =>
            controller.enqueue(chunk)
          )
          enqueueFinish(controller, state)
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
