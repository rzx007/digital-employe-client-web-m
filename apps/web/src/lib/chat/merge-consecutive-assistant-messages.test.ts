import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"

import { mergeConsecutiveAssistantMessages } from "./merge-consecutive-assistant-messages"

function asst(id: string, text: string): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text }],
  } as unknown as UIMessage
}

describe("mergeConsecutiveAssistantMessages 轮次分隔", () => {
  it("相邻 assistant 轮次合并时,前一轮末尾补段落分隔(\\n\\n),避免文字连成一段", () => {
    const merged = mergeConsecutiveAssistantMessages([
      asst("a1", "…完成后会自动同步结果。"),
      asst("a2", "全部完成！文档已生成"),
    ])
    expect(merged).toHaveLength(1)
    const parts = merged[0].parts as Array<{ type: string; text?: string }>
    // 第一条(非末条)text part 以 \n\n 结尾,与第二条分隔
    expect(parts[0].type).toBe("text")
    expect(parts[0].text?.endsWith("\n\n")).toBe(true)
    // 末条原样(流式安全:不给最后一条加)
    expect(parts[parts.length - 1].text).toBe("全部完成！文档已生成")
  })

  it("单条 assistant 不合并、不加分隔", () => {
    const merged = mergeConsecutiveAssistantMessages([asst("a1", "你好。")])
    expect(merged).toHaveLength(1)
    const parts = merged[0].parts as Array<{ text?: string }>
    expect(parts[0].text).toBe("你好。")
  })

  it("user 消息隔断:不跨 user 合并", () => {
    const user = { id: "u1", role: "user", parts: [] } as unknown as UIMessage
    const merged = mergeConsecutiveAssistantMessages([
      asst("a1", "第一轮"),
      user,
      asst("a2", "第二轮"),
    ])
    expect(merged.map((m) => m.id)).toEqual(["a1", "u1", "a2"])
  })
})
