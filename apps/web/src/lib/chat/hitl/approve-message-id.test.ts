import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"

import { resolveHitlApproveMessageId } from "./approve-message-id"
import { HITL_APPROVE_MESSAGE_ID_META_KEY } from "./message-id"

describe("resolveHitlApproveMessageId", () => {
  it("reads approveMessageId from merged assistant metadata", () => {
    const message = {
      id: "client-uuid-1",
      role: "assistant",
      parts: [],
      metadata: {
        [HITL_APPROVE_MESSAGE_ID_META_KEY]: "42",
      },
    } as UIMessage

    expect(resolveHitlApproveMessageId(message, null)).toBe("42")
  })

  it("prefers activeHitl when tool call is on the message", () => {
    const message = {
      id: "client-uuid-2",
      role: "assistant",
      parts: [
        {
          type: "tool-delete_employee",
          toolCallId: "call_abc",
          state: "input-available",
        },
      ],
    } as UIMessage

    expect(
      resolveHitlApproveMessageId(message, {
        dbMessageId: "99",
        toolCallId: "call_abc",
        kind: "destructive-delete",
      })
    ).toBe("99")
  })
})
