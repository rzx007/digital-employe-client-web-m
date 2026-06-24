import { describe, it, expect } from "vitest"
import type { UIMessage } from "ai"

import { sealLiveAssistantParts } from "./seal-live-assistant-parts"

function userMsg(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] } as UIMessage
}
function assistantMsg(
  id: string,
  text: string,
  metadata?: Record<string, unknown>
): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text }],
    ...(metadata ? { metadata } : {}),
  } as UIMessage
}

describe("sealLiveAssistantParts", () => {
  it("把最后一条 assistant 标记为 cancelled，保留其 parts", () => {
    const input = [userMsg("u1", "hi"), assistantMsg("a1", "已经生成了一半")]
    const out = sealLiveAssistantParts(input)
    const last = out[out.length - 1]
    expect(last.parts).toEqual(input[1].parts)
    expect(
      (last.metadata as Record<string, unknown> | undefined)?.streamState
    ).toBe("cancelled")
  })

  it("保留已有 metadata 其他字段，仅补 streamState", () => {
    const input = [assistantMsg("a1", "x", { elapsed_ms: 1200 })]
    const out = sealLiveAssistantParts(input)
    const meta = out[0].metadata as Record<string, unknown>
    expect(meta.elapsed_ms).toBe(1200)
    expect(meta.streamState).toBe("cancelled")
  })

  it("最后一条不是 assistant（如用户刚发出）→ 原样返回", () => {
    const input = [assistantMsg("a1", "done"), userMsg("u2", "再问")]
    const out = sealLiveAssistantParts(input)
    expect(out).toBe(input)
  })

  it("空数组 → 原样返回", () => {
    const input: UIMessage[] = []
    expect(sealLiveAssistantParts(input)).toBe(input)
  })

  it("不修改入参（返回新数组与新消息对象）", () => {
    const input = [assistantMsg("a1", "partial")]
    const out = sealLiveAssistantParts(input)
    expect(out).not.toBe(input)
    expect(out[0]).not.toBe(input[0])
    expect(
      (input[0].metadata as Record<string, unknown> | undefined)?.streamState
    ).toBeUndefined()
  })
})
