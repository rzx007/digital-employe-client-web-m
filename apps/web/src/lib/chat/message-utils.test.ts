import { describe, expect, it } from "vitest"

import { mapStoredMessagesToUIMessages } from "./message-utils"
import type { Message } from "@/types/chat"

describe("mapStoredMessagesToUIMessages queue placeholder", () => {
  it("does not render a placeholder bubble while streaming with queue hint content", () => {
    const messages: Message[] = [
      {
        id: "db:99",
        role: "assistant",
        content: "已加入执行队列，等待其他对话完成",
        streamState: "streaming",
      },
    ]
    const ui = mapStoredMessagesToUIMessages(messages)
    // 队列占位仍不渲染：顶部指示器负责 loading。
    expect(ui).toHaveLength(0)
  })

  it("keeps streaming assistant shell when no structured parts yet", () => {
    const messages: Message[] = [
      {
        id: "db:99",
        role: "assistant",
        content: "partial chunk text",
        streamState: "streaming",
      },
    ]
    const ui = mapStoredMessagesToUIMessages(messages)
    expect(ui).toHaveLength(1)
    expect(ui[0]?.parts).toEqual([])
    expect(
      (ui[0] as { metadata?: { streamState?: string } }).metadata?.streamState
    ).toBe("streaming")
  })

  it("keeps queue hint when still queued", () => {
    const messages: Message[] = [
      {
        id: "db:100",
        role: "assistant",
        content: "已加入执行队列，等待其他对话完成",
        streamState: "queued",
      },
    ]
    const ui = mapStoredMessagesToUIMessages(messages)
    expect(ui[0]?.parts[0]).toMatchObject({
      type: "text",
      text: "已加入执行队列，等待其他对话完成",
    })
  })
})
