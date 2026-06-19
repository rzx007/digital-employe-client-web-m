import { describe, expect, it } from "vitest"

import type { UIMessage } from "ai"

import { dedupePlanCardsByPlanId } from "./dedupe-plan-cards"

function planPart(planId: number) {
  return {
    type: "tool-create_orchestration_plan" as const,
    toolCallId: `call-${planId}`,
    state: "output-available" as const,
    input: { summary: "计划", tasks: [] },
    output: `{"type":"plan_generated","plan_id":${planId},"summary":"计划"}\n\n编排计划 #${planId} 已生成。`,
  }
}

function leaderMessage(id: string, planId: number): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [
      { type: "text", text: "我已安排执行计划。", state: "done" },
      planPart(planId),
    ],
  } as unknown as UIMessage
}

function countPlanParts(messages: UIMessage[]): number {
  let n = 0
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type === "tool-create_orchestration_plan") n += 1
    }
  }
  return n
}

describe("dedupePlanCardsByPlanId", () => {
  it("keeps only one plan part when two messages carry the same plan_id", () => {
    const messages = [
      leaderMessage("m1", 45),
      leaderMessage("m2", 45),
    ]
    const out = dedupePlanCardsByPlanId(messages)
    expect(countPlanParts(out)).toBe(1)
  })

  it("keeps the plan part on the LATEST message (most up-to-date state)", () => {
    const messages = [
      leaderMessage("m1", 45),
      leaderMessage("m2", 45),
    ]
    const out = dedupePlanCardsByPlanId(messages)
    const last = out[out.length - 1]
    expect(
      last.parts.some((p) => p.type === "tool-create_orchestration_plan")
    ).toBe(true)
    const first = out[0]
    expect(
      first.parts.some((p) => p.type === "tool-create_orchestration_plan")
    ).toBe(false)
  })

  it("does not drop the earlier message entirely, only its duplicate plan part", () => {
    const messages = [leaderMessage("m1", 45), leaderMessage("m2", 45)]
    const out = dedupePlanCardsByPlanId(messages)
    expect(out).toHaveLength(2)
    // 仍保留正文 text part
    expect(
      out[0].parts.some((p) => p.type === "text")
    ).toBe(true)
  })

  it("keeps distinct plan_ids as separate cards", () => {
    const messages = [leaderMessage("m1", 45), leaderMessage("m2", 46)]
    const out = dedupePlanCardsByPlanId(messages)
    expect(countPlanParts(out)).toBe(2)
  })

  it("returns the same array reference when there is nothing to dedupe", () => {
    const messages = [leaderMessage("m1", 45)]
    const out = dedupePlanCardsByPlanId(messages)
    expect(out).toBe(messages)
  })

  it("ignores messages without a plan part", () => {
    const plain: UIMessage = {
      id: "p1",
      role: "assistant",
      parts: [{ type: "text", text: "你好", state: "done" }],
    } as unknown as UIMessage
    const messages = [plain, leaderMessage("m1", 45), leaderMessage("m2", 45)]
    const out = dedupePlanCardsByPlanId(messages)
    expect(countPlanParts(out)).toBe(1)
    expect(out).toHaveLength(3)
  })
})
