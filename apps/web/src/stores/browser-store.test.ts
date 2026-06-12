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

const REAL_PATH = "D:/ws/conv/123/artifacts/report.html"
const EXPECTED_URL = `http://127.0.0.1:34567/chat/conversations/123/resources/static?path=${encodeURIComponent(
  REAL_PATH
)}`

describe("browser-store openHtmlPreview", () => {
  beforeEach(() => {
    browserOpen.mockClear()
    useBrowserStore.getState().reset()
  })

  it("builds the static URL with real path query param and opens it", () => {
    useBrowserStore.getState().openHtmlPreview(123, REAL_PATH)

    expect(browserOpen).toHaveBeenCalledTimes(1)
    expect(browserOpen).toHaveBeenCalledWith(EXPECTED_URL)

    const state = useBrowserStore.getState()
    expect(state.isOpen).toBe(true)
    expect(state.currentUrl).toBe(EXPECTED_URL)
  })

  it("url-encodes Windows backslash paths too", () => {
    const winPath = "D:\\ws\\conv\\123\\artifacts\\a.html"
    useBrowserStore.getState().openHtmlPreview(123, winPath)
    expect(browserOpen).toHaveBeenCalledWith(
      `http://127.0.0.1:34567/chat/conversations/123/resources/static?path=${encodeURIComponent(
        winPath
      )}`
    )
  })
})
