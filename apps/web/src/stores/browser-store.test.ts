import { beforeEach, describe, expect, it, vi } from "vitest"

const browserOpen = vi.fn()

vi.mock("@/lib/electron/host", () => ({
  getElectronApi: () => ({ browser: { open: browserOpen } }),
}))

vi.mock("@/lib/request", () => ({
  getRequestBaseUrl: () => "http://127.0.0.1:34567",
}))

// openBrowser 内部会触达其它 right-panel store，测试中将其 mock 成 no-op。
vi.mock("@/stores/artifact-store", () => ({
  useArtifactStore: { getState: () => ({ closeArtifact: vi.fn() }) },
}))
vi.mock("@/stores/chat-store", () => ({
  useChatStore: {
    getState: () => ({
      setActiveTab: vi.fn(),
      closeConversationList: vi.fn(),
    }),
  },
}))
vi.mock("@/stores/monitor-store", () => ({
  useMonitorStore: { getState: () => ({ closeMonitor: vi.fn() }) },
}))

import { useBrowserStore } from "./browser-store"

const EXPECTED_URL =
  "http://127.0.0.1:34567/chat/conversations/123/resources/static/artifacts/report.html"

describe("browser-store openHtmlPreview", () => {
  beforeEach(() => {
    browserOpen.mockClear()
    useBrowserStore.getState().reset()
  })

  it("builds the Task-1 static URL and opens it (leading slash path)", () => {
    useBrowserStore.getState().openHtmlPreview(123, "/artifacts/report.html")

    expect(browserOpen).toHaveBeenCalledTimes(1)
    expect(browserOpen).toHaveBeenCalledWith(EXPECTED_URL)

    const state = useBrowserStore.getState()
    expect(state.isOpen).toBe(true)
    expect(state.currentUrl).toBe(EXPECTED_URL)
  })

  it("produces the same single-slash URL when path has no leading slash", () => {
    useBrowserStore.getState().openHtmlPreview(123, "artifacts/report.html")

    expect(browserOpen).toHaveBeenCalledWith(EXPECTED_URL)

    const state = useBrowserStore.getState()
    expect(state.isOpen).toBe(true)
    expect(state.currentUrl).toBe(EXPECTED_URL)
  })
})
