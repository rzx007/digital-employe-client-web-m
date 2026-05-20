import {
  type ChatTransport,
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
  buildToolOutputStreamingChunk,
} from "./langchain-stream-parser"
import {
  sseEventSchema,
  type ToolOutputData,
} from "./langchain-sse-schema"
import { ERROR_MARKER } from "./message-classifier"
const useMock =
  import.meta.env.DEV && import.meta.env.VITE_USE_MOCK_SSE === "true"

/** 合并连续同 id 的 text-delta，减轻下游 useChat 更新次数 */
function mergeAdjacentTextDeltas(chunks: UIMessageChunk[]): UIMessageChunk[] {
  const out: UIMessageChunk[] = []
  for (const chunk of chunks) {
    if (chunk.type === "text-delta" && out.length > 0) {
      const last = out[out.length - 1]
      if (last.type === "text-delta") {
        const prev = last as { type: "text-delta"; id: string; delta: string }
        const cur = chunk as { type: "text-delta"; id: string; delta: string }
        if (prev.id === cur.id) {
          prev.delta += cur.delta
          continue
        }
      }
    }
    out.push(chunk)
  }
  return out
}

/**
 * rAF 批处理 enqueue；结束前须 flushSync，保证顺序与收尾。
 */
function createChunkFlushBatcher(
  controller: ReadableStreamDefaultController<UIMessageChunk>
) {
  let pending: UIMessageChunk[] = []
  let rafId: number | null = null

  const drainPending = () => {
    if (pending.length === 0) return
    const batch = mergeAdjacentTextDeltas(pending)
    pending = []
    for (const c of batch) {
      controller.enqueue(c)
    }
  }

  const flushSync = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    drainPending()
  }

  const schedule = (chunk: UIMessageChunk) => {
    pending.push(chunk)
    if (rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      drainPending()
    })
  }

  return { schedule, flushSync }
}


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

function buildChatApiUrl(options: { conversationId: string }) {
  return `/chat/conversations/${options.conversationId}/stream`
}

function buildResumeApiUrl(conversationId: string) {
  return `/chat/conversations/${conversationId}/stream/resume`
}

function getConversationIdFromBody(body: object | undefined) {
  if (!body || typeof body !== "object") {
    return null
  }

  const { conversationId } = body as { conversationId?: unknown }

  return conversationId ?? null
}

function getSkillFromBody(body: any): string {
  if (!body || typeof body !== "object") {
    return ''
  }

  return body?.skill || ''
}
function getExtraMetaFromBody(body: any): Record<string, any> | undefined {
  if (!body || typeof body !== "object") {
    return undefined
  }

  const { metadata } = body as { metadata?: unknown }
  return metadata && typeof metadata === "object" ? metadata as Record<string, any> : undefined
}
async function createEventSourceResponse(options: {
  conversationId: string
  prompt: string
  skill: string
  metadata?: Record<string, any>
  abortSignal: AbortSignal | undefined
}) {
  const response = await request.raw(buildChatApiUrl(options), {
    method: "POST",
    body: JSON.stringify({
      question: options.prompt,
      skill: options?.skill,
      extra_meta: options.metadata,
    }),
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
  private _reconnectAbort: AbortController | null = null

  /**
   * 取消上一次 resume 请求，防止新旧 reconnect 互相干扰
   */
  private cancelPreviousReconnect = () => {
    console.log("🚀 ~ cancelPreviousReconnect~")
    if (this._reconnectAbort) {
      this._reconnectAbort.abort()
      this._reconnectAbort = null
    }
  }

  /**
   * 中止当前 resume SSE 连接。在 handleStop 中使用，
   * 确保 stop() 能关掉 resume 建立的 SSE stream。
   */
  cancelReconnect = () => {
    this.cancelPreviousReconnect()
  }

  sendMessages = async ({
    messages,
    abortSignal,
    body,
  }: Parameters<ChatTransport<UI_MESSAGE>["sendMessages"]>[0]) => {
    this.cancelPreviousReconnect()
    const conversationId = getConversationIdFromBody(body)

    const skill = getSkillFromBody(body)
    const metadata = getExtraMetaFromBody(body)
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

    const prompt = latestText

    const stream = useMock
      ? createMockSSEStream(SeeData)
      : await createEventSourceResponse({
        conversationId: conversationId as string,
        skill,
        prompt,
        metadata,
        abortSignal,
      })

    return this.processResponseStream(stream, conversationId as string, undefined, abortSignal)
  }

  reconnectToStream = async ({
    chatId,
  }: Parameters<ChatTransport<UI_MESSAGE>["reconnectToStream"]>[0]) => {
    if (!chatId) {
      return null
    }

    this.cancelPreviousReconnect()
    const abortController = new AbortController()
    this._reconnectAbort = abortController

    const stream = await createResumeEventSourceResponse({
      conversationId: chatId,
      abortSignal: abortController.signal,
    })

    if (!stream) {
      this._reconnectAbort = null
      return null
    }

    return this.processResponseStream(stream, String(chatId), abortController, abortController.signal)
  }

  private processResponseStream = (
    stream: ReadableStream<Uint8Array>,
    conversationId?: string,
    reconnectAbort?: AbortController | null,
    abortSignal?: AbortSignal,
  ) => {
    const decoder = new TextDecoder()
    const reader = stream.getReader()

    // signal 触发时取消 reader，关闭底层 TCP 连接
    if (abortSignal) {
      const onAbort = () => reader.cancel()
      if (abortSignal.aborted) {
        onAbort()
      } else {
        abortSignal.addEventListener("abort", onAbort, { once: true })
      }
    }

    return new ReadableStream<UIMessageChunk>({
      start: async (controller) => {
        let buffer = ""
        const state = createLangChainStreamParseState()
        const { schedule, flushSync } = createChunkFlushBatcher(controller)

        controller.enqueue({ type: "start" })

        const flushEvent = (eventText: string): boolean => {
          const allLines = eventText.split(/\r?\n/)

          const dataLines = allLines
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())

          if (dataLines.length === 0) {
            return false
          }

          const data = dataLines.join("\n")

          // [DONE] → 流正常结束
          if (data === "[DONE]") {
            flushSync()
            closeTextPhaseIfNeeded(state).forEach((chunk) =>
              controller.enqueue(chunk)
            )
            enqueueFinish(controller, state)
            controller.close()
            return true
          }

          try {
            const payload = JSON.parse(data)
            const parsed = sseEventSchema.safeParse(payload)
            if (!parsed.success) {
              return false
            }

            const event = parsed.data

            // 检测流式错误事件: {"error": "<message>"}
            if (
              event &&
              typeof event === "object" &&
              "error" in event
            ) {
              const raw = (event as { error: unknown }).error
              const errorText =
                typeof raw === "string" ? raw : JSON.stringify(raw)
              flushSync()
              closeTextPhaseIfNeeded(state).forEach((chunk) =>
                controller.enqueue(chunk)
              )
              controller.enqueue({ type: "text-start", id: "stream-error" })
              controller.enqueue({
                type: "text-delta",
                id: "stream-error",
                delta: ERROR_MARKER + errorText,
              })
              controller.enqueue({ type: "text-end", id: "stream-error" })
              state.didSendFinish = true
              controller.enqueue({
                type: "finish",
                finishReason: "error" as const,
              })
              controller.close()
              return true
            }

            // stream_ended / no_stream → 后端已无更多事件，直接结束
            if (
              event &&
              typeof event === "object" &&
              "type" in event &&
              ((event as { type: string }).type === "stream_ended" ||
                (event as { type: string }).type === "no_stream")
            ) {
              flushSync()
              closeTextPhaseIfNeeded(state).forEach((chunk) =>
                controller.enqueue(chunk)
              )
              enqueueFinish(controller, state)
              controller.close()
              return true
            }

            // 处理 tool_output 流式输出事件
            if (
              event &&
              typeof event === "object" &&
              "type" in event &&
              (event as { type: string }).type === "tool_output" &&
              "data" in event
            ) {
              const toolOutputData = (event as { data: unknown })
                .data as ToolOutputData
              if (toolOutputData && typeof toolOutputData === "object") {
                flushSync()
                closeTextPhaseIfNeeded(state).forEach((chunk) =>
                  controller.enqueue(chunk)
                )
                state.currentPhase = "tool"
                const chunk = buildToolOutputStreamingChunk(toolOutputData, state)
                if (chunk) {
                  controller.enqueue(chunk)
                }
              }
              return false
            }

            const chunks = parseLangChainPayloadToChunks({
              payload: event,
              state,
            })

            for (const chunk of chunks) {
              schedule(chunk)
            }
          } catch (e) {
            if (import.meta.env.DEV) {
              console.error("[sse] dropped event:", e)
            }
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

          flushSync()
          closeTextPhaseIfNeeded(state).forEach((chunk) =>
            controller.enqueue(chunk)
          )
          enqueueFinish(controller, state)
          controller.close()
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            flushSync()
            controller.close()
          } else {
            flushSync()
            controller.enqueue({
              type: "error",
              errorText:
                error instanceof Error ? error.message : "流式响应解析失败",
            })
            controller.error(error)
          }

        } finally {
          reader.releaseLock()
          // 只清除属于当前 reconnect 的 AbortController，不覆盖新创建的
          if (reconnectAbort && this._reconnectAbort === reconnectAbort) {
            this._reconnectAbort = null
          }
        }
      },
      cancel: () => reader.cancel(),
    })
  }
}
