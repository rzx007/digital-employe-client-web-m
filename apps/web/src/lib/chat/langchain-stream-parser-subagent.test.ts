import { describe, expect, it } from "vitest"

import {
  createLangChainStreamParseState,
  parseLangChainPayloadToChunks,
} from "./langchain-stream-parser"

/** 构造一个 v2 messages 事件（带 ns），data 内是 [AIMessageChunk, metadata]。 */
function msgEvent(text: string, ns: string[] | null) {
  const aiChunk = {
    lc: 1,
    type: "constructor",
    id: ["langchain", "schema", "messages", "AIMessageChunk"],
    kwargs: { content: text, type: "AIMessageChunk" },
  }
  return {
    type: "messages",
    ns: ns ?? [],
    data: [aiChunk, {}],
  }
}

/** 模拟一个 task 工具调用出现（注册 toolCallId + 入队）。 */
function taskToolInputEvent(toolCallId: string) {
  const aiChunk = {
    lc: 1,
    type: "constructor",
    id: ["langchain", "schema", "messages", "AIMessageChunk"],
    kwargs: {
      content: "",
      type: "AIMessageChunk",
      tool_call_chunks: [
        {
          name: "task",
          args: '{"description":"子任务X"}',
          id: toolCallId,
          index: 0,
          type: "tool_call_chunk",
        },
      ],
    },
  }
  return { type: "messages", ns: [], data: [aiChunk, {}] }
}

describe("并行子任务逐字路由", () => {
  it("子任务正文（非空 ns）路由到对应 task 行的 tool-output，不进父 text", () => {
    const state = createLangChainStreamParseState()

    // 1) task 工具调用出现 → toolCallId 入队
    parseLangChainPayloadToChunks({
      payload: taskToolInputEvent("call_task_A"),
      state,
    })
    expect(state.pendingTaskToolCallIds).toContain("call_task_A")

    // 2) 子任务首个 token（带 ns）→ 绑定 ns→toolCallId，产出 tool-output-available
    const chunks = parseLangChainPayloadToChunks({
      payload: msgEvent("子任务在思考", ["tools:uuid-A"]),
      state,
    })
    expect(state.subagentNsToToolCallId.get("tools:uuid-A")).toBe("call_task_A")
    const out = chunks.find((c) => c.type === "tool-output-available") as
      | { type: string; toolCallId: string; output: string }
      | undefined
    expect(out).toBeTruthy()
    expect(out!.toolCallId).toBe("call_task_A")
    expect(out!.output).toContain("子任务在思考")
    // 关键：不能产生父 text 段
    expect(chunks.some((c) => c.type === "text-delta")).toBe(false)
  })

  it("同一 ns 的后续 token 累积到同一 task 行", () => {
    const state = createLangChainStreamParseState()
    parseLangChainPayloadToChunks({
      payload: taskToolInputEvent("call_task_A"),
      state,
    })
    parseLangChainPayloadToChunks({
      payload: msgEvent("第一段", ["tools:uuid-A"]),
      state,
    })
    const chunks = parseLangChainPayloadToChunks({
      payload: msgEvent("第二段", ["tools:uuid-A"]),
      state,
    })
    const out = chunks.find((c) => c.type === "tool-output-available") as
      | { output: string }
      | undefined
    expect(out!.output).toContain("第一段")
    expect(out!.output).toContain("第二段")
  })

  it("两个子任务按出现顺序绑定各自的 ns", () => {
    const state = createLangChainStreamParseState()
    parseLangChainPayloadToChunks({
      payload: taskToolInputEvent("call_task_1"),
      state,
    })
    parseLangChainPayloadToChunks({
      payload: taskToolInputEvent("call_task_2"),
      state,
    })
    // 第一个出现的 ns → 队首 call_task_1
    parseLangChainPayloadToChunks({
      payload: msgEvent("a", ["tools:ns-first"]),
      state,
    })
    // 第二个 ns → call_task_2
    parseLangChainPayloadToChunks({
      payload: msgEvent("b", ["tools:ns-second"]),
      state,
    })
    expect(state.subagentNsToToolCallId.get("tools:ns-first")).toBe(
      "call_task_1"
    )
    expect(state.subagentNsToToolCallId.get("tools:ns-second")).toBe(
      "call_task_2"
    )
  })

  it("子图 updates 事件（子任务内部工具调用）不平铺进父流", () => {
    const state = createLangChainStreamParseState()
    // 模拟子任务内部一次 shell execute 的 updates 事件，带非空 ns
    const subUpdates = {
      type: "updates",
      ns: ["tools:uuid-A"],
      data: {
        tools: {
          messages: [
            {
              lc: 1,
              type: "constructor",
              id: ["langchain", "schema", "messages", "ToolMessage"],
              kwargs: { content: "shell输出", type: "tool", name: "execute" },
            },
          ],
        },
      },
    }
    const chunks = parseLangChainPayloadToChunks({ payload: subUpdates, state })
    // 子图 updates 不产生任何父流 chunk（不出现「执行」行）
    expect(chunks).toHaveLength(0)
  })

  it("顶层事件（ns 空）走正常路径，不被子任务逻辑拦截", () => {
    const state = createLangChainStreamParseState()
    const chunks = parseLangChainPayloadToChunks({
      payload: msgEvent("父agent正文", []),
      state,
    })
    // 顶层正文应产生父 text 段（text-start/text-delta），不产生 tool-output
    expect(chunks.some((c) => c.type === "tool-output-available")).toBe(false)
    expect(
      chunks.some((c) => c.type === "text-delta" || c.type === "text-start")
    ).toBe(true)
  })
})
