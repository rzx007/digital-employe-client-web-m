import { describe, expect, it } from "vitest"

import {
  createLangChainStreamParseState,
  parseLangChainPayloadToChunks,
} from "./langchain-stream-parser"

/** v2 messages 事件：data 内是 [AIMessageChunk, metadata]。可带 reasoning_content。 */
function reasoningEvent(reasoning: string) {
  const aiChunk = {
    lc: 1,
    type: "constructor",
    id: ["langchain", "schema", "messages", "AIMessageChunk"],
    kwargs: {
      content: "",
      type: "AIMessageChunk",
      additional_kwargs: { reasoning_content: reasoning },
    },
  }
  return { type: "messages", ns: [], data: [aiChunk, {}] }
}

function contentEvent(text: string) {
  const aiChunk = {
    lc: 1,
    type: "constructor",
    id: ["langchain", "schema", "messages", "AIMessageChunk"],
    kwargs: { content: text, type: "AIMessageChunk" },
  }
  return { type: "messages", ns: [], data: [aiChunk, {}] }
}

type Chunk = { type: string; delta?: string; providerMetadata?: unknown }

function lcSourceOf(chunk: Chunk): unknown {
  const pm = chunk.providerMetadata as
    | { langchain?: { lcSource?: unknown } }
    | undefined
  return pm?.langchain?.lcSource
}

describe("reasoning_content 链路（Gap B 解析器）", () => {
  it("additional_kwargs.reasoning_content → 打 reasoning 标记的 text-delta", () => {
    const state = createLangChainStreamParseState()
    const chunks = parseLangChainPayloadToChunks({
      payload: reasoningEvent("先想一想"),
      state,
    }) as Chunk[]

    const delta = chunks.find((c) => c.type === "text-delta")
    expect(delta).toBeTruthy()
    expect(delta!.delta).toBe("先想一想")
    expect(lcSourceOf(delta!)).toBe("reasoning")
  })

  it("reasoning 之后切到正文 content → 关闭 reasoning 段、另起 default 段", () => {
    const state = createLangChainStreamParseState()
    parseLangChainPayloadToChunks({ payload: reasoningEvent("思考中"), state })
    const chunks = parseLangChainPayloadToChunks({
      payload: contentEvent("最终答案"),
      state,
    }) as Chunk[]

    // 切流：先 text-end 关 reasoning，再 text-start 开 default，再 text-delta 正文
    expect(chunks.some((c) => c.type === "text-end")).toBe(true)
    const delta = chunks.find((c) => c.type === "text-delta")
    expect(delta!.delta).toBe("最终答案")
    expect(lcSourceOf(delta!)).not.toBe("reasoning")
  })
})
