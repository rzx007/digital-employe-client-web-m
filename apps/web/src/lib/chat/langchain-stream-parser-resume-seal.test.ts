import { describe, expect, it } from "vitest"

import {
  createLangChainStreamParseState,
  parseLangChainPayloadToChunks,
} from "./langchain-stream-parser"

/**
 * 回归：审批后 /resume 时，deepagents 的 HumanInTheLoopMiddleware.after_model 会把
 * 触发中断的那条 AIMessage（含工具调用）+ ToolMessage 作为头部事件**重放**。
 * 这些 toolCallId 已封存在中断消息（msg_A）里，若 resume 解析再为它们产出 part，
 * 合并气泡就会重复。播种 sealedToolCallIds 后，parser 必须跳过这些重放，
 * 但仍要正常透传 resume 真正新增的文本。
 *
 * 输入取自真实抓包 hitl_2.txt（会话 339，clarify 工具 call_02553413120541b797077515）。
 */

const SEALED_ID = "call_02553413120541b797077515"

// hitl_2 id:1 —— messages 型 ToolMessage（审批答案）
const toolMessageEvent = {
  type: "messages",
  ns: [],
  data: [
    {
      lc: 1,
      type: "constructor",
      id: ["langchain", "schema", "messages", "ToolMessage"],
      kwargs: {
        content: "用户对问题的回答：\n\n1. 请问您的性别是？\n   答：男",
        type: "tool",
        name: "submit_clarifying_questions",
        id: "3552be7b-2087-4f57-ad6e-24460977da1a",
        tool_call_id: SEALED_ID,
        status: "success",
      },
    },
    { langgraph_node: "HumanInTheLoopMiddleware.after_model" },
  ],
}

// hitl_2 id:2 —— updates 重放：触发中断的 AIMessage（同一个 toolCallId）+ ToolMessage
const updatesReplayEvent = {
  type: "updates",
  ns: [],
  data: {
    "HumanInTheLoopMiddleware.after_model": {
      messages: [
        {
          lc: 1,
          type: "constructor",
          id: ["langchain", "schema", "messages", "AIMessage"],
          kwargs: {
            content: "",
            type: "ai",
            id: "lc_run--019e8e09-4efe-7b50-81bf-2cd3e253691b",
            tool_calls: [
              {
                name: "submit_clarifying_questions",
                args: { context: "general", questions: "[]" },
                id: SEALED_ID,
                type: "tool_call",
              },
            ],
            invalid_tool_calls: [],
          },
        },
      ],
    },
  },
}

// hitl_2 id:4 —— resume 真正新增的回复文本
const newTextEvent = {
  type: "messages",
  ns: [],
  data: [
    {
      lc: 1,
      type: "constructor",
      id: ["langchain", "schema", "messages", "AIMessageChunk"],
      kwargs: {
        content: "好的，已记录。",
        type: "AIMessageChunk",
        id: "lc_run--019e8e09-6816-7591-82d9-4a1c7f5c4c23",
        tool_calls: [],
        invalid_tool_calls: [],
      },
    },
    { langgraph_node: "model" },
  ],
}

function chunkToolCallId(chunk: unknown): string | null {
  if (chunk && typeof chunk === "object" && "toolCallId" in chunk) {
    const id = (chunk as { toolCallId?: unknown }).toolCallId
    return typeof id === "string" ? id : null
  }
  return null
}

describe("resume parse with sealedToolCallIds", () => {
  it("skips re-emitted parts for sealed toolCallIds but keeps new text", () => {
    const state = createLangChainStreamParseState({
      sealedToolCallIds: [SEALED_ID],
    })

    const chunks = [toolMessageEvent, updatesReplayEvent, newTextEvent].flatMap(
      (payload) => parseLangChainPayloadToChunks({ payload, state })
    )

    // 不得为已封存的 toolCallId 再产出任何 input/output chunk
    const sealedRefs = chunks.filter((c) => chunkToolCallId(c) === SEALED_ID)
    expect(sealedRefs).toHaveLength(0)

    // resume 真正新增的文本仍要透传
    expect(
      chunks.some(
        (c) =>
          (c as { type?: string }).type === "text-delta" &&
          (c as { delta?: string }).delta === "好的，已记录。"
      )
    ).toBe(true)
  })

  it("without sealing, the same resume replay DOES re-emit the duplicate tool part", () => {
    const state = createLangChainStreamParseState()

    const chunks = [toolMessageEvent, updatesReplayEvent].flatMap((payload) =>
      parseLangChainPayloadToChunks({ payload, state })
    )

    // 基线：未播种时，重放会为已封存的 toolCallId 产出 part（正是重复的来源）
    const sealedRefs = chunks.filter((c) => chunkToolCallId(c) === SEALED_ID)
    expect(sealedRefs.length).toBeGreaterThan(0)
  })
})
