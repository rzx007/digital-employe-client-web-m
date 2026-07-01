// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

import type { Artifact } from "../artifact-types"

// 隔离浏览器 store 的副作用（Electron / 网络），只暴露被断言的 action。
const openHtmlPreview = vi.fn()
vi.mock("@/stores/browser-store", () => ({
  useBrowserStore: (selector: (s: { openHtmlPreview: typeof openHtmlPreview }) => unknown) =>
    selector({ openHtmlPreview }),
}))

import {
  HtmlArtifactRenderer,
  shouldShowOpenInBrowser,
} from "./html-artifact-renderer"
import { PreviewSourceShell } from "./preview-source-shell"

const artifact: Artifact = {
  id: "art-1",
  type: "code",
  title: "demo.html",
  content: "<h1>hello</h1>",
  language: "html",
}

afterEach(() => {
  cleanup()
  openHtmlPreview.mockReset()
})

describe("shouldShowOpenInBrowser", () => {
  it("returns true only when both conversationId and filePath are present", () => {
    expect(shouldShowOpenInBrowser(1, "/artifacts/x.html")).toBe(true)
    expect(shouldShowOpenInBrowser("conv", "/artifacts/x.html")).toBe(true)
    expect(shouldShowOpenInBrowser(0, "/artifacts/x.html")).toBe(true) // 0 是合法 id
  })

  it("returns false when either is missing", () => {
    expect(shouldShowOpenInBrowser(null, "/artifacts/x.html")).toBe(false)
    expect(shouldShowOpenInBrowser(undefined, "/artifacts/x.html")).toBe(false)
    expect(shouldShowOpenInBrowser(1, null)).toBe(false)
    expect(shouldShowOpenInBrowser(1, "")).toBe(false)
    expect(shouldShowOpenInBrowser(null, null)).toBe(false)
  })
})

describe("PreviewSourceShell", () => {
  it("renders headerActions in the header when provided", () => {
    render(
      <PreviewSourceShell
        artifact={artifact}
        renderPreview={() => <div>preview</div>}
        renderSource={() => <div>source</div>}
        headerActions={<button data-testid="sentinel">行动</button>}
      />
    )
    expect(screen.getByTestId("sentinel")).toBeTruthy()
  })

  it("omits the actions container when headerActions is not provided", () => {
    render(
      <PreviewSourceShell
        artifact={artifact}
        renderPreview={() => <div>preview</div>}
        renderSource={() => <div>source</div>}
      />
    )
    expect(screen.queryByTestId("sentinel")).toBeNull()
  })
})

describe("HtmlArtifactRenderer open-in-browser button", () => {
  it("renders the button and calls openHtmlPreview with (conversationId, filePath)", () => {
    render(
      <HtmlArtifactRenderer
        artifact={artifact}
        conversationId={42}
        filePath="/artifacts/demo.html"
      />
    )
    const button = screen.getByTitle("在浏览器打开")
    button.click()
    expect(openHtmlPreview).toHaveBeenCalledTimes(1)
    expect(openHtmlPreview).toHaveBeenCalledWith(42, "/artifacts/demo.html")
  })

  it("does not render the button when conversationId/filePath are missing", () => {
    render(<HtmlArtifactRenderer artifact={artifact} />)
    expect(screen.queryByTitle("在浏览器打开")).toBeNull()
    expect(openHtmlPreview).not.toHaveBeenCalled()
  })
})
