// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

// mock 掉重资源查询与渲染器，隔离测面板自身分支
const mockUseResourceContentQuery = vi.fn()
vi.mock("@/hooks/use-chat-queries", () => ({
  useResourceContentQuery: (...args: unknown[]) =>
    mockUseResourceContentQuery(...args),
}))
vi.mock(
  "@/components/artifact/artifact-content/html-artifact-renderer",
  () => ({
    HtmlArtifactRenderer: ({ artifact }: { artifact: { content: string } }) => (
      <div data-testid="html-renderer">{artifact.content}</div>
    ),
  })
)

import { WorkbenchHtmlPanel } from "./workbench-html-panel"

const REF = { conversationId: 1, resourcePath: "/artifacts/a.html", pinnedAt: 1 }

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("WorkbenchHtmlPanel", () => {
  it("renders the html content via HtmlArtifactRenderer", () => {
    mockUseResourceContentQuery.mockReturnValue({
      data: { content: "<h1>hi</h1>", artifact_type: "code", language: "html" },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    render(<WorkbenchHtmlPanel htmlRef={REF} title="看板A" />)
    expect(screen.getByTestId("html-renderer").textContent).toBe("<h1>hi</h1>")
    expect(screen.getByText("看板A")).toBeTruthy()
  })

  it("renders missing placeholder on error", () => {
    mockUseResourceContentQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    })
    render(<WorkbenchHtmlPanel htmlRef={REF} title="看板A" />)
    expect(screen.getByText("产物已不存在或无法加载")).toBeTruthy()
    expect(screen.queryByTestId("html-renderer")).toBeNull()
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
