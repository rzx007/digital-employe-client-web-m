import { describe, expect, it } from "vitest"

import { mapStoredMessagesToUIMessages } from "./message-utils"
import type { Message } from "@/types/chat"

describe("mapStoredMessagesToUIMessages queue placeholder", () => {
  it("shows 正在执行 when streaming but content is stale queue hint", () => {
    const messages: Message[] = [
      {
        id: "db:99",
        role: "assistant",
        content: "已加入执行队列，等待其他对话完成",
        streamState: "streaming",
      },
    ]
    const ui = mapStoredMessagesToUIMessages(messages)
    expect(ui).toHaveLength(1)
    expect(ui[0]?.parts[0]).toMatchObject({
      type: "text",
      text: "正在执行…",
      state: "streaming",
    })
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
