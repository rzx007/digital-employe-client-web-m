import { describe, expect, it } from "vitest"

import { mapStoredMessagesToUIMessages } from "./message-utils"
import type { Message } from "@/types/chat"

describe("mapStoredMessagesToUIMessages queue placeholder", () => {
  it("does not render a placeholder bubble while streaming with no structured parts", () => {
    const messages: Message[] = [
      {
        id: "db:99",
        role: "assistant",
        content: "已加入执行队列，等待其他对话完成",
        streamState: "streaming",
      },
    ]
    const ui = mapStoredMessagesToUIMessages(messages)
    // 不再塞"正在执行…"假气泡：流式无结构化 parts 时不渲染这条，
    // 由顶部"正在生成回复..."指示器负责 loading，真内容由 SSE 接管。
    expect(ui).toHaveLength(0)
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
