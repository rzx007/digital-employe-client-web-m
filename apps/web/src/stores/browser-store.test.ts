import { beforeEach, describe, expect, it, vi } from "vitest"

const browserOpen = vi.fn()
const browserHide = vi.fn()

vi.mock("@/lib/electron/host", () => ({
  getElectronApi: () => ({ browser: { open: browserOpen, hide: browserHide } }),
}))

vi.mock("@/lib/request", () => ({
  getRequestBaseUrl: () => "http://127.0.0.1:34567",
}))

// openBrowser/restore 内部会触达其它 right-panel store，测试中将其 mock 成 no-op。
const closeArtifact = vi.fn()
const closeMonitor = vi.fn()
const closeSubtask = vi.fn()
const closeEmployeeTasks = vi.fn()
vi.mock("@/stores/artifact-store", () => ({
  useArtifactStore: { getState: () => ({ closeArtifact }) },
}))
vi.mock("@/stores/chat-store", () => ({
  useChatStore: {
    getState: () => ({
      setActiveTab: vi.fn(),
    }),
  },
}))
vi.mock("@/stores/monitor-store", () => ({
  useMonitorStore: { getState: () => ({ closeMonitor }) },
}))
vi.mock("@/stores/subtask-panel-store", () => ({
  useSubtaskPanelStore: { getState: () => ({ close: closeSubtask }) },
}))
vi.mock("@/stores/employee-tasks-panel-store", () => ({
  useEmployeeTasksPanelStore: { getState: () => ({ close: closeEmployeeTasks }) },
}))

import { useBrowserStore } from "./browser-store"

// 期望：把绝对路径放进 URL path 段（反斜杠归一为 /，逐段 encodeURIComponent 保留 / 作分隔）
// —— 这样浏览器对 HTML 内 ./xxx 的相对引用按同目录解析，命中后端 /static/{relpath:path}。
function expectPathFormUrl(posix: string): string {
  const encoded = posix.split("/").map(encodeURIComponent).join("/")
  return `http://127.0.0.1:34567/chat/conversations/123/static/${encoded}`
}

const REAL_PATH = "D:/ws/conv/123/artifacts/report.html"
const EXPECTED_URL = expectPathFormUrl(REAL_PATH)

describe("browser-store openHtmlPreview", () => {
  beforeEach(() => {
    browserOpen.mockClear()
    useBrowserStore.getState().reset()
  })

  it("builds a path-form static URL so relative refs in HTML resolve to siblings", () => {
    useBrowserStore.getState().openHtmlPreview(123, REAL_PATH)

    expect(browserOpen).toHaveBeenCalledTimes(1)
    expect(browserOpen).toHaveBeenCalledWith(EXPECTED_URL)

    const state = useBrowserStore.getState()
    expect(state.isOpen).toBe(true)
    expect(state.currentUrl).toBe(EXPECTED_URL)
  })

  it("normalizes Windows backslash paths to POSIX before path-segment encoding", () => {
    const winPath = "D:\\ws\\conv\\123\\artifacts\\a.html"
    useBrowserStore.getState().openHtmlPreview(123, winPath)
    expect(browserOpen).toHaveBeenCalledWith(
      expectPathFormUrl("D:/ws/conv/123/artifacts/a.html")
    )
  })
})

describe("browser-store minimize/restore（切换 panel 不中断浏览器）", () => {
  beforeEach(() => {
    browserOpen.mockClear()
    browserHide.mockClear()
    closeArtifact.mockClear()
    closeMonitor.mockClear()
    closeSubtask.mockClear()
    closeEmployeeTasks.mockClear()
    useBrowserStore.getState().reset()
  })

  it("最小化在显示中的浏览器：隐藏原生视图但保活(不销毁)、isMinimized=true、保留 currentUrl", () => {
    useBrowserStore.getState().openHtmlPreview(123, REAL_PATH)
    useBrowserStore.getState().minimizeBrowser()

    expect(browserHide).toHaveBeenCalledTimes(1)
    const s = useBrowserStore.getState()
    expect(s.isOpen).toBe(false)
    expect(s.isMinimized).toBe(true)
    expect(s.currentUrl).toBe(EXPECTED_URL) // 保活：URL 不丢，restore 不需重载
  })

  it("浏览器未显示时 minimize 为 no-op（不误置 isMinimized、不调 hide）", () => {
    useBrowserStore.getState().minimizeBrowser()
    expect(browserHide).not.toHaveBeenCalled()
    expect(useBrowserStore.getState().isMinimized).toBe(false)
  })

  it("恢复浏览器：收起其它右栏 + 重新占栏（isOpen=true/isMinimized=false，不重新 open 导航）", () => {
    useBrowserStore.getState().openHtmlPreview(123, REAL_PATH)
    useBrowserStore.getState().minimizeBrowser()
    browserOpen.mockClear()

    useBrowserStore.getState().restoreBrowser()

    const s = useBrowserStore.getState()
    expect(s.isOpen).toBe(true)
    expect(s.isMinimized).toBe(false)
    // 不通过 open() 重新导航（保留页面状态，由 BrowserPanel 挂载 show()）
    expect(browserOpen).not.toHaveBeenCalled()
    // 恢复时收起占栏的其它 panel
    expect(closeSubtask).toHaveBeenCalled()
    expect(closeEmployeeTasks).toHaveBeenCalled()
  })
})
