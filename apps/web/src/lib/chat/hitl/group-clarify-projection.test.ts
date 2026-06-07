import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"

import {
  isGroupClarifyProjectionPending,
  isLeaderClarifyResolvedInTimeline,
  resolveGroupActiveHitlFromTimeline,
} from "./group-clarify-projection"

describe("isGroupClarifyProjectionPending", () => {
  it("approved_at 后不再 pending", () => {
    const msg = {
      id: "g1",
      role: "assistant",
      parts: [
        {
          type: "tool-submit_clarifying_questions",
          state: "input-available",
          toolCallId: "c1",
          input: { questions: "[]" },
        },
      ],
      metadata: {
        clarify_target_conversation_id: 7,
        clarify_message_id: 99,
        approved_at: "2026-01-01T00:00:00.000Z",
      },
    } as unknown as UIMessage
    expect(isGroupClarifyProjectionPending(msg)).toBe(false)
  })

  it("parts 已 output-available 视为已答", () => {
    const msg = {
      id: "g2",
      role: "assistant",
      parts: [
        {
          type: "tool-submit_clarifying_questions",
          state: "output-available",
          toolCallId: "c1",
          output: { type: "text", value: "ok" },
        },
      ],
      metadata: {
        clarify_target_conversation_id: 7,
        clarify_message_id: 100,
      },
    } as unknown as UIMessage
    expect(isGroupClarifyProjectionPending(msg)).toBe(false)
  })

  it("dismissed 集合命中后不再 pending", () => {
    const msg = {
      id: "g3",
      role: "assistant",
      parts: [
        {
          type: "tool-submit_clarifying_questions",
          state: "input-available",
          toolCallId: "c3",
          input: { questions: "[]" },
        },
      ],
      metadata: {
        clarify_target_conversation_id: 7,
        clarify_message_id: 101,
      },
    } as unknown as UIMessage
    expect(isGroupClarifyProjectionPending(msg, new Set(["101"]))).toBe(false)
  })

  it("空 parts 投影不算 pending", () => {
    const msg = {
      id: "ghost",
      role: "assistant",
      parts: [],
      metadata: {
        clarify_target_conversation_id: 7,
        clarify_message_id: 102,
      },
    } as unknown as UIMessage
    expect(isGroupClarifyProjectionPending(msg)).toBe(false)
  })

  it("同 leader 消息已在别条投影作答 → 空卡片不再 pending", () => {
    const answered = {
      id: "answered",
      role: "assistant",
      parts: [
        {
          type: "tool-submit_clarifying_questions",
          state: "output-available",
          toolCallId: "c1",
          output: { type: "text", value: "用户回答" },
        },
      ],
      metadata: {
        clarify_target_conversation_id: 7,
        clarify_message_id: 200,
      },
    } as unknown as UIMessage
    const ghost = {
      id: "ghost",
      role: "assistant",
      parts: [],
      metadata: {
        clarify_target_conversation_id: 7,
        clarify_message_id: 200,
      },
    } as unknown as UIMessage
    const all = [answered, ghost] as UIMessage[]
    expect(isLeaderClarifyResolvedInTimeline(all, "200")).toBe(true)
    expect(isGroupClarifyProjectionPending(ghost, undefined, all)).toBe(false)
    expect(resolveGroupActiveHitlFromTimeline(all)).toBeNull()
  })
})

describe("resolveGroupActiveHitlFromTimeline", () => {
  it("跳过已答卡片，命中最新 pending", () => {
    const messages = [
      {
        id: "old",
        role: "assistant",
        parts: [
          {
            type: "tool-submit_clarifying_questions",
            state: "input-available",
            toolCallId: "old",
            input: { questions: "[]" },
          },
        ],
        metadata: {
          clarify_target_conversation_id: 7,
          clarify_message_id: 50,
          approved_at: "2026-01-01T00:00:00.000Z",
        },
      },
      {
        id: "new",
        role: "assistant",
        parts: [
          {
            type: "tool-submit_clarifying_questions",
            state: "input-available",
            toolCallId: "new1",
            input: {
              questions:
                '[{"id":"q1","prompt":"类型？","options":["A","B"]}]',
            },
          },
        ],
        metadata: {
          clarify_target_conversation_id: 7,
          clarify_message_id: 51,
        },
      },
    ] as unknown as UIMessage[]

    const hitl = resolveGroupActiveHitlFromTimeline(messages)
    expect(hitl?.dbMessageId).toBe("51")
    expect(hitl?.toolCallId).toBe("new1")
  })
})
