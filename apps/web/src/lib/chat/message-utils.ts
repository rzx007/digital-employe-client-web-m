import type { UIMessage, UIMessageChunk } from "ai"

import type { Message } from "@/lib/mock-data/messages"

export { classifyMessageParts, type ClassifiedBlock, type ToolGroupItem } from "./message-classifier"

import {
  closeTextPhaseIfNeeded,
  createLangChainStreamParseState,
  parseLangChainPayloadToChunks,
} from "./langchain-stream-parser"
import { ERROR_MARKER } from "./message-classifier"

export function getTextFromUIMessage(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

// --- 从 chunk_json 重建 UIMessage parts 的逻辑 ---

interface TextAccumulator {
  id: string
  text: string
  started: boolean
}

interface ToolCallAccumulator {
  toolCallId: string
  toolName: string
  input: unknown
  inputText: string
  output: unknown
  errorText: string | null
  hasOutput: boolean
  hasError: boolean
}

/**
 * 将 chunk_json 字符串回放为 UIMessageChunk 数组，
 * 然后累积为最终的 UIMessage.parts 数组。
 *
 * chunk_json 是 SSE 流中每个 data 行的 JSON 数组的序列化，
 * 每个元素形如 [langchainChunk, metadata]。
 *
 * @param chunkJson - 服务端存储的 chunk_json 字符串（旧格式，flat data array）
 * @returns 重建的 UIMessage parts 数组；解析失败时返回 null
 */
function replayChunkJsonToParts(chunkJson: string): UIMessage["parts"] | null {
  let payloads: unknown[]

  try {
    payloads = JSON.parse(chunkJson)
  } catch {
    return null
  }

  if (!Array.isArray(payloads) || payloads.length === 0) {
    return null
  }

  return _replayPayloadsToParts(payloads)
}

/**
 * 将 stream_chunks 字符串回放为 UIMessage.parts 数组。
 *
 * stream_chunks 格式为 [{"seq":N,"data":原始payload}, ...]，
 * 与 chunk_json 的区别在于每个元素多了 seq 元数据。
 *
 * @param streamChunks - 服务端存储的 stream_chunks 字符串
 * @returns 重建的 UIMessage parts 数组；解析失败时返回 null
 */
function replayStreamChunksToParts(streamChunks: string): UIMessage["parts"] | null {
  let events: unknown[]

  try {
    events = JSON.parse(streamChunks)
  } catch {
    return null
  }

  if (!Array.isArray(events) || events.length === 0) {
    return null
  }

  const payloads: unknown[] = []
  for (const evt of events) {
    if (evt && typeof evt === "object" && "data" in evt) {
      payloads.push((evt as Record<string, unknown>).data)
    }
  }

  if (payloads.length === 0) {
    return null
  }

  return _replayPayloadsToParts(payloads)
}

function _replayPayloadsToParts(payloads: unknown[]): UIMessage["parts"] | null {
  const state = createLangChainStreamParseState()
  const allChunks: UIMessageChunk[] = []

  for (const payload of payloads) {
    try {
      if (
        payload &&
        typeof payload === "object" &&
        "status" in payload &&
        (payload as Record<string, unknown>).status === "error" &&
        "error" in payload
      ) {
        const errorText = String((payload as Record<string, unknown>).error)
        closeTextPhaseIfNeeded(state).forEach((c) => allChunks.push(c))
        allChunks.push({ type: "text-start", id: "stream-error-replay" })
        allChunks.push({
          type: "text-delta",
          id: "stream-error-replay",
          delta: ERROR_MARKER + errorText,
        })
        allChunks.push({ type: "text-end", id: "stream-error-replay" })
        break
      }

      const chunks = parseLangChainPayloadToChunks({ payload, state })
      allChunks.push(...chunks)
    } catch {
      continue
    }
  }

  const tailChunks = closeTextPhaseIfNeeded(state)
  allChunks.push(...tailChunks)

  return accumulateChunksToParts(allChunks)
}

/**
 * 将 UIMessageChunk 事件流累积为 UIMessage.parts 数组。
 *
 * 处理逻辑：
 * - text-start/delta/end 事件 → 累积为 { type: "text", text, state: "done" }
 * - tool-input-start/delta/available + tool-output 事件 → 累积为工具 part
 * - 其他事件（start、finish、error 等）→ 忽略
 */
function accumulateChunksToParts(chunks: UIMessageChunk[]): UIMessage["parts"] {
  const parts: UIMessage["parts"] = []

  // 当前正在累积的文本段
  const textMap = new Map<string, TextAccumulator>()

  // 当前正在累积的工具调用
  const toolMap = new Map<string, ToolCallAccumulator>()

  for (const chunk of chunks) {
    switch (chunk.type) {
      // --- 文本事件 ---
      case "text-start": {
        textMap.set(chunk.id, { id: chunk.id, text: "", started: true })
        break
      }

      case "text-delta": {
        const acc = textMap.get(chunk.id)
        if (acc) {
          acc.text += chunk.delta
        }
        break
      }

      case "text-end": {
        break
      }

      // --- 工具输入事件 ---

      case "tool-input-start": {
        toolMap.set(chunk.toolCallId, {
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          input: undefined,
          inputText: "",
          output: undefined,
          errorText: null,
          hasOutput: false,
          hasError: false,
        })
        break
      }

      case "tool-input-delta": {
        const acc = toolMap.get(chunk.toolCallId)
        if (acc) {
          acc.inputText += chunk.inputTextDelta
        }
        break
      }

      case "tool-input-available": {
        const acc = toolMap.get(chunk.toolCallId)
        if (acc) {
          acc.toolName = chunk.toolName
          acc.input = chunk.input
          // 如果之前通过 delta 累积了 inputText 但未成功解析为 input，
          // 也保留 inputText 以便工具 UI 展示原始输入
        }
        break
      }

      case "tool-input-error": {
        const acc = toolMap.get(chunk.toolCallId)
        if (acc) {
          acc.toolName = chunk.toolName
          acc.input = chunk.input
          acc.errorText = chunk.errorText
          acc.hasError = true
        }
        break
      }

      // --- 工具输出事件 ---

      case "tool-output-available": {
        const acc = toolMap.get(chunk.toolCallId)
        if (acc) {
          // 从 output 对象中提取额外信息（兼容 buildToolOutputChunk 的输出格式）
          const outputPayload =
            chunk.output && typeof chunk.output === "object"
              ? (chunk.output as Record<string, unknown>)
              : null

          // 如果 output 中包含 input 信息，更新到 acc
          if (outputPayload?.input && !acc.input) {
            acc.input = outputPayload.input
          }
          if (outputPayload?.inputText && !acc.inputText) {
            acc.inputText = String(outputPayload.inputText)
          }
          // 更新工具名称
          if (
            outputPayload?.toolName &&
            typeof outputPayload.toolName === "string"
          ) {
            acc.toolName = outputPayload.toolName
          }

          acc.output = chunk.output
          acc.hasOutput = true
        }
        break
      }

      case "tool-output-error": {
        const acc = toolMap.get(chunk.toolCallId)
        if (acc) {
          acc.errorText = chunk.errorText
          acc.hasError = true
        }
        break
      }

      default:
        break
    }
  }

  // --- 第二遍：按事件顺序输出 parts ---

  // 追踪已输出文本和工具的顺序
  const emittedTextIds = new Set<string>()
  const emittedToolIds = new Set<string>()

  // 收集工具输出事件中可能的 input（从 output 对象中传递）
  for (const chunk of chunks) {
    if (
      chunk.type === "tool-output-available" &&
      typeof chunk.output === "object" &&
      chunk.output !== null
    ) {
      const outputPayload = chunk.output as Record<string, unknown> | null
      if (!outputPayload) continue
      const acc = toolMap.get(chunk.toolCallId)
      if (acc && outputPayload.input && !acc.input) {
        acc.input = outputPayload.input
      }
      if (acc && outputPayload.inputText && !acc.inputText) {
        acc.inputText = String(outputPayload.inputText)
      }
      if (
        acc &&
        outputPayload.toolName &&
        typeof outputPayload.toolName === "string"
      ) {
        acc.toolName = outputPayload.toolName
      }
    }
  }

  // 按事件顺序依次输出文本和工具 parts
  for (const chunk of chunks) {
    // 文本结束事件：输出累积的文本 part
    if (chunk.type === "text-end" && !emittedTextIds.has(chunk.id)) {
      const acc = textMap.get(chunk.id)
      if (acc && acc.text) {
        parts.push({
          type: "text",
          text: acc.text,
          state: "done",
        })
      }
      emittedTextIds.add(chunk.id)
    }

    // 工具输出事件：输出完整的工具 part
    if (
      (chunk.type === "tool-output-available" ||
        chunk.type === "tool-output-error") &&
      !emittedToolIds.has(chunk.toolCallId)
    ) {
      const acc = toolMap.get(chunk.toolCallId)
      if (acc) {
        const toolPart: Record<string, unknown> = {
          type: `tool-${acc.toolName}`,
          toolCallId: acc.toolCallId,
        }

        if (acc.hasError) {
          toolPart.state = "output-error"
          toolPart.errorText = acc.errorText
          toolPart.input = acc.input
        } else if (acc.hasOutput) {
          toolPart.state = "output-available"
          toolPart.input = acc.input
          toolPart.output = acc.output
        } else {
          toolPart.state = "output-available"
          toolPart.input = acc.input
        }

        parts.push(toolPart as UIMessage["parts"][number])
        emittedToolIds.add(chunk.toolCallId)
      }
    }
  }

  // 处理未闭合的文本段（理论上 closeTextPhaseIfNeeded 已处理，保险起见）
  for (const [id, acc] of textMap) {
    if (!emittedTextIds.has(id) && acc.text) {
      parts.push({
        type: "text",
        text: acc.text,
        state: "done",
      })
    }
  }

  // 处理只有输入没有输出的工具调用（异常情况）
  for (const [toolCallId, acc] of toolMap) {
    if (!emittedToolIds.has(toolCallId)) {
      const toolPart: Record<string, unknown> = {
        type: `tool-${acc.toolName}`,
        toolCallId: acc.toolCallId,
      }

      if (acc.hasError) {
        toolPart.state = "output-error"
        toolPart.errorText = acc.errorText
      } else {
        toolPart.state = "output-available"
        toolPart.input = acc.input
      }

      parts.push(toolPart as UIMessage["parts"][number])
    }
  }

  return parts
}

/**
 * 将存储的消息列表转换为 UIMessage 列表。
 *
 * 对于 assistant 消息，按优先级尝试重建 rich parts：
 * 1. chunkJson（旧格式，flat data array）
 * 2. streamChunks（新格式，[{"seq":N,"data":...}]）
 * 3. content 纯文本降级
 * 4. streamState === "streaming" → 空 parts（等待实时流填充）
 *
 * @param messages - 存储的消息列表
 * @returns 转换后的 UIMessage 列表
 */
export function mapStoredMessagesToUIMessages(
  messages: Message[]
): UIMessage[] {
  return messages.map((message): UIMessage | null => {
    const messageMeta =
      message.metadata && typeof message.metadata === "object"
        ? message.metadata
        : undefined

    if (message.role === "assistant") {
      if (message.chunkJson) {
        const parts = replayChunkJsonToParts(message.chunkJson)

        if (parts && parts.length > 0) {
          const uiMessage: UIMessage = {
            id: message.id,
            role: message.role,
            parts,
          }
            ; (uiMessage as UIMessage & { metadata?: Record<string, any> }).metadata =
              messageMeta
          return uiMessage
        }
      }

      if (message.streamChunks) {
        const parts = replayStreamChunksToParts(message.streamChunks)

        if (parts && parts.length > 0) {
          const uiMessage: UIMessage = {
            id: message.id,
            role: message.role,
            parts,
          }
            ; (uiMessage as UIMessage & { metadata?: Record<string, any> }).metadata =
              messageMeta
          return uiMessage
        }
      }

      if (message.content) {
        const uiMessage: UIMessage = {
          id: message.id,
          role: message.role,
          parts: [
            {
              type: "text",
              text: message.content,
              state: "done" as const,
            },
          ],
        }
          ; (uiMessage as UIMessage & { metadata?: Record<string, any> }).metadata =
            messageMeta
        return uiMessage
      }

      if (message.streamState === "streaming") {
        const uiMessage: UIMessage = {
          id: message.id,
          role: message.role,
          parts: [],
        }
          ; (uiMessage as UIMessage & { metadata?: Record<string, any> }).metadata =
            messageMeta
        return uiMessage
      }

      return null
    }

    // 降级：使用 content 作为纯文本 part
    const uiMessage: UIMessage = {
      id: message.id,
      role: message.role,
      parts: [
        {
          type: "text",
          text: message.content,
          state: "done",
        },
      ],
    }
      ; (uiMessage as UIMessage & { metadata?: Record<string, any> }).metadata =
        messageMeta
    return uiMessage
  }).filter((message): message is UIMessage => message !== null)
}
