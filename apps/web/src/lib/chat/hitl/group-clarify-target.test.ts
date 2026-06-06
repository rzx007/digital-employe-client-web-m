import { describe, it, expect } from "vitest"
import { resolveGroupClarifyTarget } from "./group-clarify-target"

describe("resolveGroupClarifyTarget", () => {
  it("从 extra_meta 取组长会话 id 与中断消息 id", () => {
    const meta = { clarify_target_conversation_id: 42, clarify_message_id: 99 }
    expect(resolveGroupClarifyTarget(meta)).toEqual({
      conversationId: 42,
      messageId: 99,
    })
  })

  it("缺字段返回 null", () => {
    expect(resolveGroupClarifyTarget({})).toBeNull()
    expect(resolveGroupClarifyTarget(undefined)).toBeNull()
    expect(resolveGroupClarifyTarget({ clarify_target_conversation_id: 42 })).toBeNull()
  })
})
