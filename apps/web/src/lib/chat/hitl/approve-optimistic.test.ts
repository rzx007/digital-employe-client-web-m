import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"

import type { Message } from "@/types/chat"
import {
  patchApprovedAtOnComposerMessages,
  patchApprovedAtOnMessagesCache,
} from "./approve-optimistic"
import { QueryClient } from "@tanstack/react-query"
import { chatKeys } from "@/lib/query-keys/chat"

const APPROVED_AT = "2026-06-06T00:00:00.000Z"

describe("approve-optimistic 群投影卡片命中", () => {
  // 群澄清卡片：行 id 是群消息自己的 id，clarify_message_id 才等于被 approve 的组长消息 id。
  // 回归保护：曾因匹配只认 row.id / approveMessageId，patch 打不中投影卡片 →
  // groupActiveHitl 永不为 null → dock 关不掉，重复提交后端回「该消息已审批」。
  it("composer：靠 clarify_message_id 给群投影卡片打 approved_at", () => {
    const prev: UIMessage[] = [
      {
        id: "group-555", // 群消息自身 id，与组长消息 id 不同
        role: "assistant",
        parts: [],
        metadata: {
          clarify_message_id: 123,
          clarify_target_conversation_id: 7,
        },
      } as unknown as UIMessage,
    ]

    const next = patchApprovedAtOnComposerMessages(prev, 123, APPROVED_AT)

    const meta = (next[0] as UIMessage & { metadata?: Record<string, unknown> })
      .metadata
    expect(meta?.approved_at).toBe(APPROVED_AT)
  })

  it("cache：靠 clarify_message_id 给群投影卡片打 approved_at", () => {
    const qc = new QueryClient()
    const convKey = "999"
    const rows: Message[] = [
      {
        id: "group-555",
        role: "assistant",
        content: "",
        metadata: {
          clarify_message_id: 123,
          clarify_target_conversation_id: 7,
        },
      } as unknown as Message,
    ]
    qc.setQueryData(chatKeys.messages(convKey), rows)

    patchApprovedAtOnMessagesCache(qc, convKey, 123, APPROVED_AT)

    const out = qc.getQueryData<Message[]>(chatKeys.messages(convKey))
    expect(out?.[0].metadata?.approved_at).toBe(APPROVED_AT)
  })

  it("不误伤：clarify_message_id 不匹配时不打标", () => {
    const prev: UIMessage[] = [
      {
        id: "group-555",
        role: "assistant",
        parts: [],
        metadata: { clarify_message_id: 999 },
      } as unknown as UIMessage,
    ]
    const next = patchApprovedAtOnComposerMessages(prev, 123, APPROVED_AT)
    const meta = (next[0] as UIMessage & { metadata?: Record<string, unknown> })
      .metadata
    expect(meta?.approved_at).toBeUndefined()
  })
})
