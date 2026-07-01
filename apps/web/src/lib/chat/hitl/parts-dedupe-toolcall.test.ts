import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"

import { dedupeHitlPartsInMessage } from "./parts-dedupe"

function toolPart(
  name: string,
  toolCallId: string,
  state: string,
  output?: unknown
) {
  return {
    type: `tool-${name}`,
    toolCallId,
    state,
    ...(output !== undefined ? { output } : {}),
  }
}

function assistantMessage(parts: unknown[]): UIMessage {
  return { id: "m1", role: "assistant", parts } as unknown as UIMessage
}

/**
 * 防御层（B）：合并气泡内同一 toolCallId 的工具块只保留一份，优先保留有最终 output 的，
 * 不依赖 HITL 类型、不依赖 pending/resolved 状态对齐——兜住 A 之外的残余重放重复。
 */
describe("dedupe tool parts by toolCallId (defense for resume replay)", () => {
  it("collapses duplicate non-HITL tool parts sharing a toolCallId", () => {
    const msg = assistantMessage([
      toolPart("ls", "call_x", "output-available", "a.ts\nb.ts"),
      toolPart("ls", "call_x", "output-available", "a.ts\nb.ts"),
    ])
    const out = dedupeHitlPartsInMessage(msg)
    const lsParts = out.parts.filter((p) => p.type === "tool-ls")
    expect(lsParts).toHaveLength(1)
  })

  it("keeps the resolved copy when one duplicate has output and the other is pending", () => {
    const msg = assistantMessage([
      toolPart("execute", "call_y", "input-available"),
      toolPart("execute", "call_y", "output-available", "done"),
    ])
    const out = dedupeHitlPartsInMessage(msg)
    const parts = out.parts.filter((p) => p.type === "tool-execute")
    expect(parts).toHaveLength(1)
    expect((parts[0] as { state?: string }).state).toBe("output-available")
  })

  it("does not collapse distinct toolCallIds", () => {
    const msg = assistantMessage([
      toolPart("ls", "call_a", "output-available", "x"),
      toolPart("ls", "call_b", "output-available", "y"),
    ])
    const out = dedupeHitlPartsInMessage(msg)
    expect(out.parts.filter((p) => p.type === "tool-ls")).toHaveLength(2)
  })
})
