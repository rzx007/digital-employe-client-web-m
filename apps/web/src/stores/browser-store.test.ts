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

describe("browser-store backgroundSessions 回收契约", () => {
  beforeEach(() => {
    useBrowserStore.getState().reset()
  })

  it("noteBackgroundOpen 记录后台会话，clearBackground 精确删除单个 id", () => {
    const store = useBrowserStore.getState()
    store.noteBackgroundOpen("a", "https://a.example")
    store.noteBackgroundOpen("b", "https://b.example")
    expect(useBrowserStore.getState().backgroundSessions.has("a")).toBe(true)
    expect(useBrowserStore.getState().backgroundSessions.has("b")).toBe(true)

    store.clearBackground("a")
    const after = useBrowserStore.getState().backgroundSessions
    expect(after.has("a")).toBe(false)
    expect(after.has("b")).toBe(true)
  })

  it("clearBackground 对不存在的 id 幂等、不抛错、不误删", () => {
    const store = useBrowserStore.getState()
    store.noteBackgroundOpen("b", "https://b.example")
    expect(() => store.clearBackground("nope")).not.toThrow()
    expect(useBrowserStore.getState().backgroundSessions.has("b")).toBe(true)
  })

  it("reset 故意保留 backgroundSessions（跨前台留存）", () => {
    const store = useBrowserStore.getState()
    store.noteBackgroundOpen("b", "https://b.example")
    store.reset()
    expect(useBrowserStore.getState().backgroundSessions.has("b")).toBe(true)
  })
})
