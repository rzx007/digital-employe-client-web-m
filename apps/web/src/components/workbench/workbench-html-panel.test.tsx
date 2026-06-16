// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

// mock 掉重资源查询，隔离测面板自身分支
const mockUseResourceContentQuery = vi.fn()
vi.mock("@/hooks/use-chat-queries", () => ({
  useResourceContentQuery: (...args: unknown[]) =>
    mockUseResourceContentQuery(...args),
}))

import { WorkbenchHtmlPanel } from "./workbench-html-panel"

const REF = { conversationId: 1, resourcePath: "/artifacts/a.html", pinnedAt: 1 }

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("WorkbenchHtmlPanel", () => {
  it("renders the html directly in a sandboxed iframe (no preview/source tabs)", () => {
    mockUseResourceContentQuery.mockReturnValue({
      data: { content: "<h1>hi</h1>", artifact_type: "code", language: "html" },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    const { container } = render(
      <WorkbenchHtmlPanel htmlRef={REF} title="看板A" />
    )
    const iframe = container.querySelector("iframe")
    expect(iframe).not.toBeNull()
    // 内容经 wrapHtmlForPreview 包裹后注入 srcdoc
    expect(iframe?.getAttribute("srcdoc")).toContain("<h1>hi</h1>")
    // 沙箱属性在场（递归修复依赖它）
    expect(iframe?.getAttribute("sandbox")).toContain("allow-scripts")
    // 标题显示，但不应出现「预览/源码」切换
    expect(screen.getByText("看板A")).toBeTruthy()
    expect(screen.queryByText("源码")).toBeNull()
    expect(screen.queryByText("预览")).toBeNull()
  })

  it("renders missing placeholder on error", () => {
    mockUseResourceContentQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    })
    const { container } = render(
      <WorkbenchHtmlPanel htmlRef={REF} title="看板A" />
    )
    expect(screen.getByText("产物已不存在或无法加载")).toBeTruthy()
    expect(container.querySelector("iframe")).toBeNull()
  })

  it("renders loading state while fetching", () => {
    mockUseResourceContentQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    })
    render(<WorkbenchHtmlPanel htmlRef={REF} title="看板A" />)
    expect(screen.getByText("加载中…")).toBeTruthy()
  })
})
