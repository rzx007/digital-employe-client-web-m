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
import { MAX_STREAM_RESUME_ATTEMPTS } from "@/lib/chat/session/resume-decision"

const CONV_ID = 339

function makeMessage(partial: Partial<Message> & Pick<Message, "id" | "role">): Message {
  return {
    conversationId: String(CONV_ID),
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

  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries")

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

  return { view, resumeStream, setMessages, queryClient, invalidateSpy }
}

/** 取某次 renderSession 里 invalidateQueries 被调用过的所有 queryKey（JSON 串）。 */
function invalidatedKeys(
  spy: ReturnType<typeof vi.spyOn>
): string[] {
  return spy.mock.calls.map(([arg]) =>
    JSON.stringify((arg as { queryKey?: unknown } | undefined)?.queryKey)
  )
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

  it("切流拖影根因①：切回时 transport 残留同会话「在飞」resume 归属（切走那拍调度的死连接）→ 仍必须 resume，不被 inflight 闸永久挡住", async () => {
    // 模拟切走那一拍：unmount 的 stop() abort 触发 retryResume，给 transport 设了
    // 本会话「在飞」归属。若切回不硬清这个残留，shouldSkipResumeWhenInFlight 命中→
    // resume 0 次→当前轮气泡空白直到 idle 看门狗回收/二次进来。
    const { chatTransport } = await import(
      "@/components/chat/shared/chat-view-shared"
    )
    const t = chatTransport as unknown as {
      _reconnectAbort: AbortController | null
      _reconnectChatId: string | null
    }
    t._reconnectAbort = new AbortController()
    t._reconnectChatId = String(CONV_ID)

    try {
      const { resumeStream } = renderSession({
        storedMessages: storedWithLastAssistant("streaming"),
        status: "ready",
      })

      await waitFor(() => expect(resumeStream).toHaveBeenCalledTimes(1))
    } finally {
      t._reconnectAbort = null
      t._reconnectChatId = null
    }
  })

  it("空续（no_stream）热循环：composer 不增长时 retryResume 受 MAX 配额封顶、不无限重试", async () => {
    vi.useFakeTimers()
    try {
      const resumeStream = vi.fn()
      const setMessages = vi.fn()
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      const stored = storedWithLastAssistant("streaming")
      // retryResumeIfNeeded 从 query cache 读末尾 assistant
      queryClient.setQueryData(chatKeys.messages(String(CONV_ID)), stored)
      const initialMessages = mapStoredMessagesToUIMessages(stored)

      const { result } = renderHook(() =>
        useConversationSession({
          conversationId: CONV_ID,
          contactId: null,
          storedMessages: stored,
          initialMessages,
          // 关键：composer 永不增长 = 每次 resume 都是「空续」（仅 start 无内容）。
          // 旧实现据「status→streaming」重置配额会无限重试；新实现据「内容增长」判定，
          // 空续不重置 → 8 次触顶后停。
          composerMessages: [],
          status: "streaming",
          setMessages,
          resumeStream,
          queryClient,
        })
      )

      // 模拟 onTerminal(no_stream) 反复触发续流；每轮推进过最长退避让已调度 resume 落地
      for (let i = 0; i < 30; i++) {
        result.current.retryResumeIfNeeded()
        await vi.advanceTimersByTimeAsync(11_000)
      }

      expect(resumeStream.mock.calls.length).toBeGreaterThan(0)
      expect(resumeStream.mock.calls.length).toBeLessThanOrEqual(
        MAX_STREAM_RESUME_ATTEMPTS
      )
    } finally {
      vi.useRealTimers()
    }
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

describe("useConversationSession — 快结束切换：进入兜底态立即补拉终态(不等 4s)", () => {
  // 复刻已知能稳定通过的 renderSession 结构（与 line 84「resume on re-enter」同形），
  // 只额外 spy invalidateQueries 断言「进入兜底态(本地 ready + DB streaming)立刻补拉
  // 一次 messages」。手写 renderHook + spy 真实 invalidate 曾触发 happy-dom worker
  // 死循环（与 helper 的差异在隔离/清理），故沿用 helper。
  it("本地 ready 但 DB 末条 assistant 仍 streaming → 立刻 invalidate 一次 messages(消除 4s 工具卡空窗)", async () => {
    const { invalidateSpy } = renderSession({
      storedMessages: storedWithLastAssistant("streaming"),
      status: "ready",
    })

    // 立即补拉用 setTimeout(0) 异步派发（避开同步重入），故等一个宏任务再断言。
    await new Promise((r) => setTimeout(r, 0))

    const messagesKey = JSON.stringify(chatKeys.messages(String(CONV_ID)))
    expect(invalidatedKeys(invalidateSpy)).toContain(messagesKey)
  })
})

describe("useConversationSession — 中断塌文字：终态但 parts 暂缺立即补拉", () => {
  it("DB 末条 assistant=cancelled + 无 message_parts + 有 content → 立刻补拉一次(等后端 parts 落库)", async () => {
    // 模拟点中断后那一拍：DB 已 patch 成 cancelled、content 是流式累积的脏文本，但后端
    // _flush_terminal 还没把 message_parts 落完。不补拉则渲染回退成一坨纯文字、工具卡塌。
    const stored: Message[] = [
      makeMessage({ id: "100", role: "user", content: "查热搜" }),
      makeMessage({
        id: "101",
        role: "assistant",
        content: "正在打开微博\nbrowserctl ...(脏文本)",
        streamState: "cancelled",
        messageParts: undefined, // 关键：终态但 parts 还没落
      }),
    ]
    const { invalidateSpy } = renderSession({
      storedMessages: stored,
      status: "ready",
    })

    await new Promise((r) => setTimeout(r, 0))

    const messagesKey = JSON.stringify(chatKeys.messages(String(CONV_ID)))
    expect(invalidatedKeys(invalidateSpy)).toContain(messagesKey)
  })

  it("DB 末条 assistant=cancelled + 已有 message_parts → 不补拉(避免无谓刷新)", async () => {
    const { invalidateSpy } = renderSession({
      // storedWithLastAssistant 自带 messageParts → 已有结构，不该触发终态补拉
      storedMessages: storedWithLastAssistant("cancelled"),
      status: "ready",
    })

    await new Promise((r) => setTimeout(r, 0))

    const messagesKey = JSON.stringify(chatKeys.messages(String(CONV_ID)))
    // 注意：onStreamFinish 等其它路径不会在纯渲染挂载时触发；这里断言「终态补拉」未发生
    expect(invalidatedKeys(invalidateSpy)).not.toContain(messagesKey)
  })
})
