import { type ChatTransport, type UIMessage, type UIMessageChunk } from "ai"

import { request, getRequestHeaders } from "@/lib/request"
import { createMockSSEStream } from "@/lib/dev/mock-sse-stream"
import { MOCK_SSE_TEXT } from "@/lib/mock-data/sse"
import {
  closeTextPhaseIfNeeded,
  createLangChainStreamParseState,
  enqueueFinish,
  parseLangChainPayloadToChunks,
  buildToolOutputStreamingChunks,
} from "./langchain-stream-parser"
import { sseEventSchema, type ToolOutputData } from "./langchain-sse-schema"
import { ERROR_MARKER } from "./message-classifier"
import {
  isBenignStreamAbortError,
  isStreamDisconnectedError,
  StreamDisconnectedError,
} from "./stream-abort"
import { conversationRuntimeBus } from "./conversation-runtime-bus"
import {
  buildHitlInterruptStreamChunks,
  collectHitlToolCallIdsAlreadyStreamed,
} from "./hitl/interrupt-stream-chunks"
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

/** 合并连续同 toolCallId 的 tool-input-delta（write_file 流式 args） */
function mergeAdjacentToolInputDeltas(
  chunks: UIMessageChunk[]
): UIMessageChunk[] {
  const out: UIMessageChunk[] = []
  for (const chunk of chunks) {
    if (chunk.type === "tool-input-delta" && out.length > 0) {
      const last = out[out.length - 1]
      if (last.type === "tool-input-delta") {
        const prev = last as {
          type: "tool-input-delta"
          toolCallId: string
          inputTextDelta: string
        }
        const cur = chunk as {
          type: "tool-input-delta"
          toolCallId: string
          inputTextDelta: string
        }
        if (prev.toolCallId === cur.toolCallId) {
          prev.inputTextDelta += cur.inputTextDelta
          continue
        }
      }
    }
    out.push(chunk)
  }
  return out
}

function compactStreamChunks(chunks: UIMessageChunk[]): UIMessageChunk[] {
  return mergeAdjacentToolInputDeltas(mergeAdjacentTextDeltas(chunks))
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
    const batch = compactStreamChunks(pending)
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

/**
 * SSE idle 看门狗超时：连续这么久没从连接收到**任何字节**（含后端每 5~10s 的心跳），
 * 即判连接「假死」（TCP 还在但中间层 buffer 住/掐断了数据，reader.read() 永久 pending）。
 * 超时后主动 cancel reader → 抛 StreamDisconnectedError → 上层 resume 续流。
 * 取值须 > 后端心跳间隔的数倍，避免误杀正常的慢心跳；后端心跳 5s 一次，这里 20s。
 */
const SSE_IDLE_TIMEOUT_MS = 20_000

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
    const batch = compactStreamChunks(pending)
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
  try {
    const response = await request.raw(
      buildResumeApiUrl(options.conversationId),
      {
        method: "GET",
        headers: getRequestHeaders({
          Accept: "text/event-stream",
          // 注意：这里**故意不发** Last-Event-ID / after_seq 做增量续流。后端虽支持只回
          // 放 seq>N，但前端解析器（langchain-stream-parser）每开一个 text 段都用
          // generatePartId() 随机 id，且 resume 时 parse state 全新重建——增量续流只送
          // 「尾部」会以一个**新随机 id 的 text part** 出现，AI SDK 据 id 归并时既接不回
          // 断点前的前缀、又可能重复/碎片化。故 resume 一律走「从 seq 0 全量重放」，让
          // useChat 从头重建整条消息（幂等）。真正要做增量续流，得先让 part id 跨 resume
          // 稳定（按 seq/消息位置派生而非随机），属更大改动，另案。
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
  } catch (error) {
    if (options.abortSignal?.aborted || isBenignStreamAbortError(error)) {
      return null
    }
    throw error
  }
}

export class LangChainChatTransport<
  UI_MESSAGE extends UIMessage,
> implements ChatTransport<UI_MESSAGE> {
  private _reconnectAbort: AbortController | null = null
  /** 当前在飞 resume 连接所属的会话 id（无在飞连接时为 null）。用于 resume 止抖判定。 */
  private _reconnectChatId: string | null = null
  _resumeConversationId: string | null = null
  /** 下一次 resume 时要跳过的、已封存在中断消息里的 toolCallId（防 HITL 重放重复） */
  private _resumeSealedToolCallIds: string[] = []
  onInterrupted:
    | ((payload: {
        message_id?: string | number | null
        message_parts?: unknown[]
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
    this._reconnectChatId = null
  }

  /**
   * 中止当前 resume SSE 连接。在 handleStop 中使用，
   * 确保 stop() 能关掉 resume 建立的 SSE stream。
   */
  cancelReconnect = () => {
    this.cancelPreviousReconnect()
  }

  /**
   * 当前在飞 resume 连接所属的会话 id；无在飞连接时为 null。供上层在调度 resumeStream()
   * 前止抖：同会话已有在飞连接时跳过新触发，避免反复 abort+全量重放导致画面从头重打。
   * 假死连接由 idle 看门狗(SSE_IDLE_TIMEOUT_MS) 回收→届时返回 null→自然放行重连。
   */
  getInFlightResumeChatId = (): string | null =>
    this._reconnectAbort != null ? this._reconnectChatId : null

  setResumeConversationId = (id: string | null) => {
    this._resumeConversationId = id
  }

  /** 审批后 resume 前调用：登记中断消息里已封存的 toolCallId，resume 解析将跳过其重放 */
  setResumeSealedToolCallIds = (ids: string[]) => {
    this._resumeSealedToolCallIds = ids
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
      ? createMockSSEStream(MOCK_SSE_TEXT)
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
    this._reconnectChatId = effectiveChatId

    let stream: ReadableStream<Uint8Array> | null
    try {
      stream = await createResumeEventSourceResponse({
        conversationId: effectiveChatId,
        abortSignal: abortController.signal,
      })
    } catch (error) {
      if (
        abortController.signal.aborted ||
        isBenignStreamAbortError(error)
      ) {
        this._reconnectAbort = null
        this._reconnectChatId = null
        return null
      }
      throw error
    }

    if (!stream) {
      this._reconnectAbort = null
      this._reconnectChatId = null
      return null
    }

    this._resumeConversationId = null
    // 读取并清空封存集合（仅本次 resume 生效，避免影响后续普通续传）
    const sealedToolCallIds = this._resumeSealedToolCallIds
    this._resumeSealedToolCallIds = []

    return this.processResponseStream(
      stream,
      effectiveChatId,
      abortController,
      abortController.signal,
      sealedToolCallIds
    )
  }

  private processResponseStream = (
    stream: ReadableStream<Uint8Array>,
    conversationId?: string,
    reconnectAbort?: AbortController | null,
    abortSignal?: AbortSignal,
    sealedToolCallIds?: string[]
  ) => {
    const decoder = new TextDecoder()
    const reader = stream.getReader()

    // signal 触发时：优雅收尾（flush 已收 chunk + 补 text-end + finish）再取消 reader，
    // 避免裸 cancel 丢掉 rAF batcher 里尚未 flush 给 SDK 的 chunk（现象1 根因）。
    // gracefulAbort 由内层 start 闭包登记（它持有 controller/flushSync/state）；
    // abort 早于 start 执行完成的极端情况下 gracefulAbort 可能还没登记，回退裸 cancel。
    let gracefulAbort: (() => void) | null = null
    if (abortSignal) {
      const onAbort = () => {
        if (gracefulAbort) {
          gracefulAbort()
        } else {
          void reader.cancel()
        }
      }
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
        const state = createLangChainStreamParseState({ sealedToolCallIds })
        const { schedule, flushSync } = createChunkBatcherForMode(
          isReconnect,
          controller,
          reconnectStats
        )

        // 所有 close 点共用，防重复 close（gracefulAbort 与 [DONE]/interrupted/
        // 错误/正常结束/benign cancel 等终态分支可能相互竞争）。
        let streamClosed = false
        // 供外层 onAbort 调用：与 [DONE] 同样收尾，确保停止时 batcher 残留不丢。
        gracefulAbort = () => {
          if (streamClosed) return
          streamClosed = true
          try {
            flushSync()
            closeTextPhaseIfNeeded(state).forEach((chunk) =>
              controller.enqueue(chunk)
            )
            enqueueFinish(controller, state)
            controller.close()
          } catch {
            /* controller 已被 SDK 关闭/锁定则忽略 */
          }
          void reader.cancel()
        }

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
            if (streamClosed) return true
            streamClosed = true
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
              if (streamClosed) return true
              const messageId = payload.message_id as
                | string
                | number
                | undefined
              const messageParts = payload.message_parts
              if (conversationId) {
                conversationRuntimeBus.emitInterrupted(conversationId, {
                  message_id: messageId,
                  message_parts: messageParts,
                })
                conversationRuntimeBus.emitTerminal(conversationId, {
                  status: "interrupted",
                  message_id: messageId,
                })
              }
              this.onInterrupted?.({
                message_id: messageId,
                message_parts: messageParts,
              })
              flushSync()
              closeTextPhaseIfNeeded(state).forEach((chunk) =>
                controller.enqueue(chunk)
              )
              // 已有落库 message_parts 时由 onInterrupted 整体替换 composer parts，勿再灌 tool chunks
              const hasAuthoritativeParts =
                Array.isArray(messageParts) && messageParts.length > 0
              if (!hasAuthoritativeParts) {
                for (const chunk of buildHitlInterruptStreamChunks(
                  messageParts,
                  {
                    skipToolCallIds:
                      collectHitlToolCallIdsAlreadyStreamed(state),
                  }
                )) {
                  controller.enqueue(chunk)
                }
              }
              enqueueFinish(controller, state)
              streamClosed = true
              controller.close()
              return true
            }

            const parsed = sseEventSchema.safeParse(payload)
            if (!parsed.success) {
              return false
            }

            const event = parsed.data

            if (
              event &&
              typeof event === "object" &&
              "type" in event &&
              (event as { type: string }).type === "agent_queued"
            ) {
              const queued = event as {
                message?: string
                position?: number
              }
              const message =
                queued.message ??
                `已加入执行队列${queued.position ? `（第 ${queued.position} 位）` : ""}`
              flushSync()
              closeTextPhaseIfNeeded(state).forEach((chunk) =>
                controller.enqueue(chunk)
              )
              controller.enqueue({ type: "text-start", id: "agent-queued" })
              controller.enqueue({
                type: "text-delta",
                id: "agent-queued",
                delta: message,
              })
              controller.enqueue({ type: "text-end", id: "agent-queued" })
              return false
            }

            // 检测流式错误事件: {"error": "<message>"}
            if (event && typeof event === "object" && "error" in event) {
              if (streamClosed) return true
              streamClosed = true
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
              if (streamClosed) return true
              // HITL: interrupted 状态 — 通知上层
              const eventData = (
                event as {
                  data?: {
                    status?: string
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
                conversationRuntimeBus.emitTerminal(conversationId, {
                  status: terminalStatus,
                  message_id: eventData?.message_id,
                })
              }

              if (eventData?.status === "interrupted") {
                const interruptPayload = {
                  message_id: eventData.message_id,
                }
                if (conversationId) {
                  conversationRuntimeBus.emitInterrupted(
                    conversationId,
                    interruptPayload
                  )
                }
                this.onInterrupted?.(interruptPayload)
              }

              if (
                eventData?.status === "error" &&
                typeof eventData.error === "string" &&
                eventData.error.trim()
              ) {
                const errorText = eventData.error.trim()
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
                streamClosed = true
                controller.close()
                return true
              }

              flushSync()
              closeTextPhaseIfNeeded(state).forEach((chunk) =>
                controller.enqueue(chunk)
              )
              enqueueFinish(controller, state)
              streamClosed = true
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

        // 是否见过权威终止信号（[DONE]/interrupted/stream_ended/no_stream/error）。
        // reader done 时若仍为 false，说明连接在 turn 结束前被对端关闭——
        // 不能当作正常 finish，否则执行会话会「假结束」。
        let sawAuthoritativeFinish = false
        // idle 看门狗：每次 read 都和一个超时赛跑；收到任何字节即重置。超时 = 连接
        // 假死（中间层 buffer/掐断，read() 永久 pending），按断流处理交上层 resume。
        let idleTimer: ReturnType<typeof setTimeout> | null = null
        const readWithIdleWatchdog = (): Promise<
          ReadableStreamReadResult<Uint8Array>
        > => {
          return new Promise((resolve, reject) => {
            idleTimer = setTimeout(() => {
              // 主动断开假死连接：cancel 会让 reader.read() reject/resolve，
              // 但我们已用 StreamDisconnectedError 走 reject，下游统一当断流处理。
              reader.cancel().catch(() => {})
              reject(new StreamDisconnectedError())
            }, SSE_IDLE_TIMEOUT_MS)
            reader.read().then(
              (result) => {
                if (idleTimer) clearTimeout(idleTimer)
                resolve(result)
              },
              (err) => {
                if (idleTimer) clearTimeout(idleTimer)
                reject(err)
              }
            )
          })
        }
        try {
          while (true) {
            const { done, value } = await readWithIdleWatchdog()
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
                sawAuthoritativeFinish = true
                if (import.meta.env.DEV && reconnectStats) {
                  console.info("[sse:resume] reconnect batching", {
                    sseEvents: reconnectSseEvents,
                    chunksScheduled: reconnectStats.scheduled,
                    chunksEnqueued: reconnectStats.enqueued,
                    flushRounds: reconnectStats.flushRounds,
                  })
                }
                return
              }

              separatorIndex = getEventBoundaryIndex(buffer)
            }
          }

          if (buffer.trim()) {
            // 残留 buffer 可能正好是 [DONE] 等终止事件，需据其返回值更新判定
            sawAuthoritativeFinish =
              (await flushEvent(buffer)) || sawAuthoritativeFinish
          }

          // 收到 done 但从未见权威终止信号 = 连接中途断开、turn 可能仍在跑。
          // 抛可识别的中断错误交上层 resume 续流，而非 enqueueFinish 假收尾。
          if (!sawAuthoritativeFinish) {
            flushSync()
            controller.error(new StreamDisconnectedError())
            return
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
          if (!streamClosed) {
            streamClosed = true
            controller.close()
          }
        } catch (error) {
          if (isBenignStreamAbortError(error)) {
            // gracefulAbort 已优雅收尾并 cancel reader 时，read() 在此 reject benign，
            // streamClosed 已 true → 跳过重复 close。
            if (!streamClosed) {
              streamClosed = true
              flushSync()
              controller.close()
            }
          } else if (isStreamDisconnectedError(error)) {
            // idle 看门狗超时（连接假死）：不吐 error 块（否则会在气泡里冒一条
            // 可见报错），只 error 出 StreamDisconnectedError 交上层 resume 续流。
            flushSync()
            controller.error(error)
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
          if (idleTimer) clearTimeout(idleTimer)
          reader.releaseLock()
          // 只清除属于当前 reconnect 的 AbortController，不覆盖新创建的
          if (reconnectAbort && this._reconnectAbort === reconnectAbort) {
            this._reconnectAbort = null
            this._reconnectChatId = null
          }
        }
      },
      cancel: () => reader.cancel(),
    })
  }
}
