// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
vi.mock("@/api/workbench", () => ({
  resolveMetric: vi.fn(async () => ({ items: [{ label: "x", value: 1 }] })),
}))
import { useMetricData } from "./use-metric-data"

describe("useMetricData", () => {
  it("解析 dataSource 返回 WidgetData", async () => {
    const qc = new QueryClient()
    const wrapper = ({ children }: any) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(
      () => useMetricData({ metricId: "m", refreshSec: 0 }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.data?.items?.[0]?.label).toBe("x"))
  })
  it("无 dataSource 时不取数(disabled)", () => {
    const qc = new QueryClient()
    const wrapper = ({ children }: any) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useMetricData(undefined), { wrapper })
    expect(result.current.fetchStatus).toBe("idle")
  })
})
