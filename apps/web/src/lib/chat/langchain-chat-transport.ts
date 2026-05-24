import { type ChatTransport, type UIMessage, type UIMessageChunk } from "ai"

import { request, getRequestHeaders } from "@/lib/request"
import { SeeData, createMockSSEStream } from "@/lib/mock-data/sse"
import {
  closeTextPhaseIfNeeded,
  createLangChainStreamParseState,
  enqueueFinish,
  parseLangChainPayloadToChunks,
  buildToolOutputStreamingChunks,
} from "./langchain-stream-parser"
import { sseEventSchema, type ToolOutputData } from "./langchain-sse-schema"
import { ERROR_MARKER } from "./message-classifier"
import { conversationRuntimeBus } from "./conversation-runtime-bus"
import type { HitlPayload } from "./conversation-runtime-types"
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

/** Resume 回放：时间窗 + 上限批处理，减少 useChat 更新次数 */
const RECONNECT_FLUSH_MS = 48
const RECONNECT_MAX_CHUNKS_PER_FLUSH = 256
/** 每处理 N 条 SSE 后 flush 并让出主线程，避免长时间占用 */
const RECONNECT_YIELD_EVERY_EVENTS = 320

type ChunkFlushBatcher = {
  schedule: (chunk: UIMessageChunk) => void
  flushSync: () => void
}

/**
 * GET /stream/resume 冷回放专用：48ms 一批或满 256 chunk 即 flush。
 * 正常 POST /stream 仍用 rAF 批处理以保持跟手。
 */
function createReconnectChunkFlushBatcher(
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  stats?: { scheduled: number; enqueued: number; flushRounds: number }
): ChunkFlushBatcher {
  let pending: UIMessageChunk[] = []
  let timerId: ReturnType<typeof setTimeout> | null = null

  const drainPending = () => {
    if (pending.length === 0) return
    const batch = mergeAdjacentTextDeltas(pending)
    pending = []
    if (stats) {
      stats.flushRounds += 1
      stats.enqueued += batch.length
    }
    for (const c of batch) {
      controller.enqueue(c)
    }
  }

  const flushSync = () => {
    if (timerId !== null) {
      clearTimeout(timerId)
      timerId = null
    }
    drainPending()
  }

  const scheduleTimer = () => {
    if (timerId !== null) return
    timerId = setTimeout(() => {
      timerId = null
      drainPending()
    }, RECONNECT_FLUSH_MS)
  }

  const schedule = (chunk: UIMessageChunk) => {
    if (stats) stats.scheduled += 1
    pending.push(chunk)
    if (pending.length >= RECONNECT_MAX_CHUNKS_PER_FLUSH) {
      flushSync()
      return
    }
    scheduleTimer()
  }

  return { schedule, flushSync }
}

function createChunkBatcherForMode(
  isReconnect: boolean,
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  reconnectStats?: {
    scheduled: number
    enqueued: number
    flushRounds: number
  }
): ChunkFlushBatcher {
  return isReconnect
    ? createReconnectChunkFlushBatcher(controller, reconnectStats)
    : createChunkFlushBatcher(controller)
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
    return ""
  }

  return body?.skill || ""
}
function getExtraMetaFromBody(body: any): Record<string, any> | undefined {
  if (!body || typeof body !== "object") {
    return undefined
  }

  const { metadata } = body as { metadata?: unknown }
  return metadata && typeof metadata === "object"
    ? (metadata as Record<string, any>)
    : undefined
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
  _resumeConversationId: string | null = null
  onInterrupted:
    | ((payload: {
        action_requests: unknown[]
        review_configs: unknown[]
        message_id?: string | number | null
      }) => void)
    | null = null

  /**
   * 取消上一次 resume 请求，防止新旧 reconnect 互相干扰
   */
  private cancelPreviousReconnect = () => {
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

  setResumeConversationId = (id: string | null) => {
    this._resumeConversationId = id
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

    return this.processResponseStream(
      stream,
      conversationId as string,
      undefined,
      abortSignal
    )
  }

  reconnectToStream = async ({
    chatId,
  }: Parameters<ChatTransport<UI_MESSAGE>["reconnectToStream"]>[0]) => {
    const effectiveChatId = this._resumeConversationId ?? chatId
    if (!effectiveChatId) {
      return null
    }

    this.cancelPreviousReconnect()
    const abortController = new AbortController()
    this._reconnectAbort = abortController

    const stream = await createResumeEventSourceResponse({
      conversationId: effectiveChatId,
      abortSignal: abortController.signal,
    })

    if (!stream) {
      this._reconnectAbort = null
      return null
    }

    this._resumeConversationId = null

    return this.processResponseStream(
      stream,
      effectiveChatId,
      abortController,
      abortController.signal
    )
  }

  private processResponseStream = (
    stream: ReadableStream<Uint8Array>,
    conversationId?: string,
    reconnectAbort?: AbortController | null,
    abortSignal?: AbortSignal
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
        const isReconnect = reconnectAbort != null
        const reconnectStats = isReconnect
          ? { scheduled: 0, enqueued: 0, flushRounds: 0 }
          : undefined
        let buffer = ""
        let reconnectSseEvents = 0
        const state = createLangChainStreamParseState()
        const { schedule, flushSync } = createChunkBatcherForMode(
          isReconnect,
          controller,
          reconnectStats
        )

        controller.enqueue({ type: "start" })

        const maybeYieldAfterReconnectBurst = async () => {
          if (!isReconnect) return
          reconnectSseEvents += 1
          if (reconnectSseEvents % RECONNECT_YIELD_EVERY_EVENTS !== 0) return
          flushSync()
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 0)
          })
        }

        const flushEvent = async (eventText: string): Promise<boolean> => {
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

            // HITL: interrupted 终态 — 回调后正常结束流
            if (
              payload &&
              typeof payload === "object" &&
              payload.status === "interrupted"
            ) {
              const interruptPayload: HitlPayload = {
                action_requests: (payload.action_requests ??
                  []) as HitlPayload["action_requests"],
                review_configs: (payload.review_configs ?? []) as unknown[],
              }
              const messageId = payload.message_id as
                | string
                | number
                | undefined
              if (conversationId) {
                conversationRuntimeBus.emitInterrupted(conversationId, {
                  ...interruptPayload,
                  message_id: messageId,
                })
                conversationRuntimeBus.emitTerminal(conversationId, {
                  status: "interrupted",
                  message_id: messageId,
                  interrupt_payload: interruptPayload,
                })
              }
              this.onInterrupted?.({
                action_requests: interruptPayload.action_requests,
                review_configs: interruptPayload.review_configs,
                message_id: messageId,
              })
              flushSync()
              closeTextPhaseIfNeeded(state).forEach((chunk) =>
                controller.enqueue(chunk)
              )
              enqueueFinish(controller, state)
              controller.close()
              return true
            }

            const parsed = sseEventSchema.safeParse(payload)
            if (!parsed.success) {
              return false
            }

            const event = parsed.data

            // 检测流式错误事件: {"error": "<message>"}
            if (event && typeof event === "object" && "error" in event) {
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
              // HITL: interrupted 状态 — 通知上层
              const eventData = (
                event as {
                  data?: {
                    status?: string
                    interrupt_payload?: HitlPayload
                    message_id?: string | number | null
                    error?: string
                  }
                }
              ).data
              const terminalStatus =
                (event as { type: string }).type === "no_stream"
                  ? "no_stream"
                  : ((eventData?.status as
                      | "completed"
                      | "cancelled"
                      | "error"
                      | "interrupted"
                      | undefined) ?? "completed")

              if (conversationId) {
                if (
                  eventData?.status === "interrupted" &&
                  eventData.interrupt_payload
                ) {
                  conversationRuntimeBus.emitInterrupted(conversationId, {
                    ...eventData.interrupt_payload,
                    message_id: eventData.message_id,
                  })
                }
                conversationRuntimeBus.emitTerminal(conversationId, {
                  status: terminalStatus,
                  message_id: eventData?.message_id,
                  interrupt_payload: eventData?.interrupt_payload,
                })
              }

              if (
                eventData?.status === "interrupted" &&
                eventData.interrupt_payload
              ) {
                this.onInterrupted?.({
                  ...eventData.interrupt_payload,
                  message_id: eventData.message_id,
                })
              }
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
                const toolChunks = buildToolOutputStreamingChunks(
                  toolOutputData,
                  state
                )
                for (const chunk of toolChunks) {
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
            await maybeYieldAfterReconnectBurst()
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

              const didFinish = await flushEvent(eventText)
              if (didFinish) {
                if (import.meta.env.DEV && reconnectStats) {
                  console.info(
                    "[sse:resume] reconnect batching",
                    {
                      sseEvents: reconnectSseEvents,
                      chunksScheduled: reconnectStats.scheduled,
                      chunksEnqueued: reconnectStats.enqueued,
                      flushRounds: reconnectStats.flushRounds,
                    }
                  )
                }
                return
              }

              separatorIndex = getEventBoundaryIndex(buffer)
            }
          }

          if (buffer.trim()) {
            await flushEvent(buffer)
          }

          flushSync()
          if (import.meta.env.DEV && reconnectStats) {
            console.info("[sse:resume] reconnect batching (stream end)", {
              sseEvents: reconnectSseEvents,
              chunksScheduled: reconnectStats.scheduled,
              chunksEnqueued: reconnectStats.enqueued,
              flushRounds: reconnectStats.flushRounds,
            })
          }
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
