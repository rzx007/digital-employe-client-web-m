// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"

// transport 是单例：mock 掉 cancelReconnect，断言卸载时被调用（清掉 in-flight
// resume 归属，否则切回会被 shouldSkipResumeWhenInFlight 闸挡住 → 气泡空白）。
const cancelReconnect = vi.fn()
vi.mock("@/components/chat/shared/chat-view-shared", () => ({
  chatTransport: {
    cancelReconnect: () => cancelReconnect(),
  },
}))

import { useStreamCleanupOnUnmount } from "./use-stream-cleanup-on-unmount"

describe("useStreamCleanupOnUnmount", () => {
  beforeEach(() => {
    cancelReconnect.mockClear()
  })

  it("卸载时调用 stop() 与 transport.cancelReconnect()，断开本会话尚在进行的 SSE", () => {
    const stop = vi.fn()
    const { unmount } = renderHook(() => useStreamCleanupOnUnmount(stop))

    // 挂载期间不应触发清理
    expect(stop).not.toHaveBeenCalled()
    expect(cancelReconnect).not.toHaveBeenCalled()

    unmount()

    expect(stop).toHaveBeenCalledTimes(1)
    expect(cancelReconnect).toHaveBeenCalledTimes(1)
  })

  it("卸载时调用最新的 stop（避免捕获到首渲染的旧闭包）", () => {
    const firstStop = vi.fn()
    const latestStop = vi.fn()
    const { rerender, unmount } = renderHook(({ stop }) =>
      useStreamCleanupOnUnmount(stop), {
      initialProps: { stop: firstStop },
    })

    rerender({ stop: latestStop })
    unmount()

    expect(firstStop).not.toHaveBeenCalled()
    expect(latestStop).toHaveBeenCalledTimes(1)
  })
})
