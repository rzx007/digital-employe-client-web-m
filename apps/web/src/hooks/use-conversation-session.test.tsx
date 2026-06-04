// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient } from "@tanstack/react-query"

import type { Message } from "@/types/chat"
import { mapStoredMessagesToUIMessages } from "@/lib/chat/message-utils"

// 集成测试与网络隔离：底层 HTTP 走 ofetch（@/lib/request），整模块 mock 掉，
// 避免 happy-dom 下杂散请求产生 ECONNREFUSED 未处理拒绝污染输出 / 变脆。
// 工厂会被 hoist，内部不得引用外部变量。
vi.mock("ofetch", () => {
  const blocked = () => Promise.reject(new Error("network disabled in test"))
  const fn = Object.assign(blocked, {
    create: () => fn,
    raw: blocked,
    native: blocked,
  })
  return { ofetch: fn, $fetch: fn, createFetch: () => fn }
})

import { useConversationSession } from "./use-conversation-session"

const CONV_ID = 339

function makeMessage(partial: Partial<Message> & Pick<Message, "id" | "role">): Message {
  return {
    conversationId: String(CONV_ID),
    senderId: "s",
    senderName: "n",
    content: "",
    timestamp: new Date("2026-01-01T00:00:00Z"),
    ...partial,
  } as Message
}

function storedWithLastAssistant(streamState: string | null): Message[] {
  return [
    makeMessage({ id: "100", role: "user", content: "hi" }),
    makeMessage({
      id: "101",
      role: "assistant",
      content: "writing...",
      streamState,
      messageParts: [{ type: "text", text: "writing...", state: "streaming" }],
    }),
  ]
}

function renderSession(
  overrides: {
    storedMessages: Message[]
    status?: string
    composerMessages?: never[]
  } & Partial<{ resumeStream: () => void; setMessages: () => void }>
) {
  const resumeStream = vi.fn()
  const setMessages = vi.fn()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const initialMessages = mapStoredMessagesToUIMessages(overrides.storedMessages)

  const view = renderHook(() =>
    useConversationSession({
      conversationId: CONV_ID,
      contactId: null,
      storedMessages: overrides.storedMessages,
      initialMessages,
      composerMessages: [],
      status: overrides.status ?? "ready",
      setMessages,
      resumeStream,
      queryClient,
    })
  )

  return { view, resumeStream, setMessages, queryClient }
}

describe("useConversationSession — resume on re-enter", () => {
  it("resumes exactly once when last assistant is still streaming (regression: rAF must survive self-dispatch)", async () => {
    const { resumeStream } = renderSession({
      storedMessages: storedWithLastAssistant("streaming"),
      status: "ready",
    })

    await waitFor(() => expect(resumeStream).toHaveBeenCalledTimes(1))

    // 再等一拍，确认不会重复 resume（resumeAttemptedFor 去重）
    await new Promise((r) => setTimeout(r, 40))
    expect(resumeStream).toHaveBeenCalledTimes(1)
  })

  it("does not resume when last assistant has completed", async () => {
    const { resumeStream } = renderSession({
      storedMessages: storedWithLastAssistant("completed"),
      status: "ready",
    })

    await new Promise((r) => setTimeout(r, 60))
    expect(resumeStream).not.toHaveBeenCalled()
  })

  it("resumes on remount when local status is streaming but session was inactive", async () => {
    const { resumeStream } = renderSession({
      storedMessages: storedWithLastAssistant("streaming"),
      status: "streaming",
    })

    await waitFor(() => expect(resumeStream).toHaveBeenCalledTimes(1))
  })
})
