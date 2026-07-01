// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest"
import { renderHook, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

let capturedHandler: ((e: { type: string }) => void) | undefined
vi.mock("@/hooks/use-workspace-events", () => ({
  useWorkspaceEvents: (h: (e: { type: string }) => void) => {
    capturedHandler = h
  },
}))

const fetchWorkbench = vi.fn(async () => ({
  dashboard: { widgets: [] },
  htmlTabs: [],
  tabOrder: ["dashboard"],
  activeTabId: "dashboard",
  updatedAt: 0,
}))
vi.mock("@/api/workbench", () => ({
  fetchWorkbench: () => fetchWorkbench(),
  saveWorkbench: vi.fn(async (c: unknown) => c),
}))

import { useWorkbenchConfig } from "./use-workbench-config"

describe("useWorkbenchConfig", () => {
  it("收到 workbench_changed 事件后重新拉配置(后端加的 widget 即时出现)", async () => {
    const qc = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    renderHook(() => useWorkbenchConfig(), { wrapper })

    await waitFor(() => expect(fetchWorkbench).toHaveBeenCalledTimes(1))
    act(() => capturedHandler?.({ type: "workbench_changed" }))
    await waitFor(() => expect(fetchWorkbench).toHaveBeenCalledTimes(2))
  })

  it("无关事件不触发重新拉", async () => {
    fetchWorkbench.mockClear()
    const qc = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    renderHook(() => useWorkbenchConfig(), { wrapper })
    await waitFor(() => expect(fetchWorkbench).toHaveBeenCalledTimes(1))
    act(() => capturedHandler?.({ type: "task_started" }))
    // 给一拍时间确保没有额外 refetch
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchWorkbench).toHaveBeenCalledTimes(1)
  })
})
