// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { describe, it, expect, vi, afterEach } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { WorkbenchTabs } from "./workbench-tabs"
import type { WorkbenchConfig } from "@/types/workbench"

const cfg: WorkbenchConfig = {
  dashboard: { widgets: [] },
  htmlTabs: [
    {
      id: "tab-1",
      title: "报表",
      htmlRef: { conversationId: "c", resourcePath: "/r.html", pinnedAt: 1 },
    },
  ],
  tabOrder: ["dashboard", "tab-1"],
  activeTabId: "dashboard",
  updatedAt: 0,
}

const wrap = (ui: React.ReactNode) => {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
  )
}

describe("WorkbenchTabs", () => {
  afterEach(() => cleanup())
  it("dashboard 标签存在且不可关闭", () => {
    wrap(<WorkbenchTabs config={cfg} onChange={vi.fn()} />)
    expect(screen.getByText("工作台")).toBeTruthy()
    expect(screen.queryByTestId("close-dashboard")).toBeNull()
  })

  it("HTML 标签可关闭,点关闭触发 removeTab(onChange)", () => {
    const onChange = vi.fn()
    wrap(<WorkbenchTabs config={cfg} onChange={onChange} />)
    fireEvent.click(screen.getByTestId("close-tab-1"))
    expect(onChange).toHaveBeenCalled()
  })

  it("点 HTML 标签切换 active(onChange)", () => {
    const onChange = vi.fn()
    wrap(<WorkbenchTabs config={cfg} onChange={onChange} />)
    fireEvent.click(screen.getByText("报表"))
    expect(onChange).toHaveBeenCalled()
  })
})
