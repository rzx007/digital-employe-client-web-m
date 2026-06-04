// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient } from "@tanstack/react-query"

import type { Message } from "@/types/chat"
import { mapStoredMessagesToUIMessages } from "@/lib/chat/message-utils"
import { chatKeys } from "@/lib/query-keys/chat"

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

describe("useConversationSession — refetch 防抖不应被 status 变化清掉（Bug1 回归）", () => {
  it("onStreamFinish 调度的 800ms 回拉，即便期间 status 变化也要触发", () => {
    vi.useFakeTimers()
    try {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")
      const stored = storedWithLastAssistant("completed")
      const initial = mapStoredMessagesToUIMessages(stored)
      // 桩须「稳定引用」（模拟 useChat 的 setMessages/resumeStream 跨渲染不变），
      // 否则 rerender 时新 fn 引用本身就会重跑总线 effect，掩盖 status 这个真正变量。
      const setMessages = vi.fn()
      const resumeStream = vi.fn()
      const makeProps = (status: string) => ({
        conversationId: CONV_ID,
        contactId: "emp-1", // 命不中 store 联系人 → 不发网络
        storedMessages: stored,
        initialMessages: initial,
        composerMessages: [] as never[],
        status,
        setMessages,
        resumeStream,
        queryClient,
      })

      const { rerender, result } = renderHook(
        (p: ReturnType<typeof makeProps>) => useConversationSession(p),
        { initialProps: makeProps("submitted") }
      )

      invalidateSpy.mockClear()

      // 流结束：调度 800ms 后回拉 /messages
      result.current.onStreamFinish()
      // 紧接着 status 变化（触发 bug 的关键：总线 effect 重跑 → 清 refetch 定时器）
      rerender(makeProps("ready"))
      // 推进过防抖点
      vi.advanceTimersByTime(900)

      const messagesKey = JSON.stringify(chatKeys.messages(String(CONV_ID)))
      const calledForMessages = invalidateSpy.mock.calls.some(([arg]) => {
        const key = (arg as { queryKey?: unknown } | undefined)?.queryKey
        return JSON.stringify(key) === messagesKey
      })

      expect(calledForMessages).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
