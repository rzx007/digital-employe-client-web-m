import { describe, it, expect } from "vitest"
import { classifyMessageParts } from "./message-classifier"

describe("milestone classification", () => {
  it("emits a member-milestone block when metadata.milestone present", () => {
    const msg = {
      id: "m1",
      role: "assistant",
      parts: [{ type: "text", text: "文案已完成" }],
      metadata: {
        senderName: "张三",
        role: "worker",
        milestone: { kind: "delivered", text: "文案已完成", artifacts: ["a/r.md"] },
      },
    } as never
    const blocks = classifyMessageParts(msg, { includeFileChanges: false })
    const m = blocks.find((b) => b.kind === "member-milestone")
    expect(m).toBeTruthy()
    expect((m as { senderName: string }).senderName).toBe("张三")
    expect((m as { milestoneKind: string }).milestoneKind).toBe("delivered")
    expect((m as { text: string }).text).toBe("文案已完成")
    expect((m as { artifacts?: string[] }).artifacts).toEqual(["a/r.md"])
  })

  it("falls back to '成员' when senderName missing", () => {
    const msg = {
      id: "m2",
      role: "assistant",
      parts: [],
      metadata: { milestone: { kind: "accepted", text: "收到" } },
    } as never
    const blocks = classifyMessageParts(msg, { includeFileChanges: false })
    const m = blocks.find((b) => b.kind === "member-milestone")
    expect(m).toBeTruthy()
    expect((m as { senderName: string }).senderName).toBe("成员")
  })
})
