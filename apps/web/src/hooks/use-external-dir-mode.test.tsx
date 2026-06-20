// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import * as React from "react"

// ---- 屏蔽所有网络（ofetch mock，必须 hoist） ----
vi.mock("ofetch", () => {
  const blocked = () => Promise.reject(new Error("network disabled in test"))
  const fn = Object.assign(blocked, {
    create: () => fn,
    raw: blocked,
    native: blocked,
  })
  return { ofetch: fn, $fetch: fn, createFetch: () => fn }
})

// ---- mock api/conversation 中的两个端点函数 ----
const getExternalDirModeMock = vi.fn<
  (conversationId: number | string) => Promise<"ask" | "auto" | "deny">
>()
const setExternalDirModeMock = vi.fn<
  (
    conversationId: number | string,
    mode: "ask" | "auto" | "deny"
  ) => Promise<"ask" | "auto" | "deny">
>()

vi.mock("@/api/conversation", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/api/conversation")>()
  return {
    ...actual,
    getExternalDirMode: (
      ...args: Parameters<typeof getExternalDirModeMock>
    ) => getExternalDirModeMock(...args),
    setExternalDirMode: (
      ...args: Parameters<typeof setExternalDirModeMock>
    ) => setExternalDirModeMock(...args),
  }
})

import { useExternalDirMode } from "./use-external-dir-mode"

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
}

const CONV_ID = 42

afterEach(() => {
  getExternalDirModeMock.mockReset()
  setExternalDirModeMock.mockReset()
})

describe("useExternalDirMode", () => {
  it("conversationId 为 null 时 query 不触发，mode 为 undefined", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(() => useExternalDirMode(null), {
      wrapper: makeWrapper(qc),
    })

    // 稍等，确认没有发请求
    await new Promise((r) => setTimeout(r, 30))
    expect(getExternalDirModeMock).not.toHaveBeenCalled()
    expect(result.current.mode).toBeUndefined()
  })

  it("有 conversationId 时 query 拉取并返回 mode", async () => {
    getExternalDirModeMock.mockResolvedValue("ask")
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useExternalDirMode(CONV_ID), {
      wrapper: makeWrapper(qc),
    })

    await waitFor(() => expect(result.current.mode).toBe("ask"))
    expect(getExternalDirModeMock).toHaveBeenCalledWith(CONV_ID)
  })

  it("setMode('auto') 调用 setExternalDirMode 并触发 PATCH", async () => {
    getExternalDirModeMock.mockResolvedValue("ask")
    setExternalDirModeMock.mockResolvedValue("auto")
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useExternalDirMode(CONV_ID), {
      wrapper: makeWrapper(qc),
    })

    // 等初始 query 完成
    await waitFor(() => expect(result.current.mode).toBe("ask"))

    // 调 setMode
    result.current.setMode("auto")

    await waitFor(() =>
      expect(setExternalDirModeMock).toHaveBeenCalledWith(CONV_ID, "auto")
    )
  })

  it("setMode 成功后 invalidate 重新拉取 mode", async () => {
    getExternalDirModeMock
      .mockResolvedValueOnce("ask")
      .mockResolvedValueOnce("auto")
    setExternalDirModeMock.mockResolvedValue("auto")
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useExternalDirMode(CONV_ID), {
      wrapper: makeWrapper(qc),
    })

    await waitFor(() => expect(result.current.mode).toBe("ask"))

    result.current.setMode("auto")

    // invalidate 后重拉，最终 mode 变为 auto
    await waitFor(() => expect(result.current.mode).toBe("auto"))
  })
})
