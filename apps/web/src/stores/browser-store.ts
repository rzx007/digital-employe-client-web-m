import { create } from "zustand"

import { getElectronApi } from "@/lib/electron/host"
import { getRequestBaseUrl } from "@/lib/request"
import { useArtifactStore } from "@/stores/artifact-store"
import { useChatStore } from "@/stores/chat-store"
import { useMonitorStore } from "@/stores/monitor-store"
import { useSubtaskPanelStore } from "@/stores/subtask-panel-store"

const MIN_WIDTH_RATIO = 0.3
const MAX_WIDTH_RATIO = 0.8
const DEFAULT_WIDTH_RATIO = 0.6

interface BrowserState {
  isOpen: boolean
  currentUrl: string
  currentTitle: string
  widthRatio: number
  isLoading: boolean
  isMinimized: boolean
  isFullscreen: boolean
  error: string | null
  canGoBack: boolean
  canGoForward: boolean
  // 当前活跃浏览器归属的会话 id（与前台一致时才渲染）；null = 无归属/调试路径
  activeBrowserConversationId: string | null
  // 有浏览器命令在跑、但不属于当前前台会话 → 静默记录（conversationId → 最后导航的 url），不渲染
  backgroundSessions: Map<string, string>

  openBrowser: (url: string) => void
  openHtmlPreview: (
    conversationId: string | number,
    virtualPath: string
  ) => void
  minimizeBrowser: () => void
  restoreBrowser: () => void
  destroyBrowser: () => void
  navigate: (url: string) => void
  goBack: () => void
  goForward: () => void
  refresh: () => void
  setWidthRatio: (ratio: number) => void
  setCurrentUrl: (
    url: string,
    title: string,
    nav?: { canGoBack: boolean; canGoForward: boolean }
  ) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  toggleFullscreen: () => void
  noteBackgroundOpen: (conversationId: string, url: string) => void
  clearBackground: (conversationId: string) => void
  adoptForeground: (conversationId: string) => void
  setActiveBrowserConversationId: (conversationId: string | null) => void
  reset: () => void
}

function clampRatio(value: number): number {
  if (Number.isNaN(value)) return DEFAULT_WIDTH_RATIO
  return Math.max(MIN_WIDTH_RATIO, Math.min(MAX_WIDTH_RATIO, value))
}

function closeOtherRightPanels() {
  useMonitorStore.getState().closeMonitor()
  useArtifactStore.getState().closeArtifact()
  useChatStore.getState().closeConversationList()
  useSubtaskPanelStore.getState().close()
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return trimmed
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

export const useBrowserStore = create<BrowserState>((set, get) => ({
  isOpen: false,
  currentUrl: "",
  currentTitle: "",
  widthRatio: DEFAULT_WIDTH_RATIO,
  isLoading: false,
  error: null,
  isMinimized: false,
  isFullscreen: false,
  canGoBack: false,
  canGoForward: false,
  activeBrowserConversationId: null,
  backgroundSessions: new Map<string, string>(),

  openBrowser: (url: string) => {
    closeOtherRightPanels()
    useChatStore.getState().setActiveTab("chat")

    const api = getElectronApi()
    if (!api?.browser) {
      console.warn(
        "[browser-store] window.electronApi.browser is missing — preload 可能未加载新版 (需要重启 Electron)"
      )
      return
    }
    const normalized = normalizeUrl(url)
    set({
      isOpen: true,
      isMinimized: false,
      currentUrl: normalized,
      currentTitle: "",
      isLoading: true,
      error: null,
    })
    void api.browser.open(normalized)
  },

  openHtmlPreview: (conversationId, realPath) => {
    const base = getRequestBaseUrl().replace(/\/$/, "")
    // 路径式静态服务：把绝对路径放在 URL path 段（反斜杠归一为 /，逐段 encodeURIComponent
    // 保留 / 作分隔），让浏览器对 HTML 内 ./xxx 的相对引用按同目录解析。
    // 旧的 ?path= 形态相对解析会丢 query，落到 …/resources/xxx 撞 404。
    const posix = realPath.replace(/\\/g, "/")
    const encoded = posix.split("/").map(encodeURIComponent).join("/")
    const url = `${base}/chat/conversations/${conversationId}/static/${encoded}`
    get().openBrowser(url)
  },

  minimizeBrowser: () => {
    const api = getElectronApi()
    void api?.browser.hide()
    set({ isOpen: false, isMinimized: true, error: null, isFullscreen: false })
  },

  restoreBrowser: () => {
    const { currentUrl } = get()
    if (!currentUrl) return
    const api = getElectronApi()
    if (!api?.browser) return
    void api.browser.open(currentUrl)
    set({ isOpen: true, isMinimized: false, isLoading: true, error: null })
  },

  destroyBrowser: () => {
    const api = getElectronApi()
    void api?.browser.close()
    set({
      isOpen: false,
      isMinimized: false,
      isFullscreen: false,
      currentUrl: "",
      currentTitle: "",
      isLoading: false,
      error: null,
      canGoBack: false,
      canGoForward: false,
    })
  },

  navigate: (url: string) => {
    const api = getElectronApi()
    if (!api?.browser) return
    const normalized = normalizeUrl(url)
    void api.browser.navigate(normalized)
    set({ currentUrl: normalized, isLoading: true, error: null })
  },

  goBack: () => {
    const api = getElectronApi()
    if (!api?.browser) return
    void api.browser.goBack()
    set({ isLoading: true, error: null })
  },

  goForward: () => {
    const api = getElectronApi()
    if (!api?.browser) return
    void api.browser.goForward()
    set({ isLoading: true, error: null })
  },

  refresh: () => {
    const { currentUrl } = get()
    if (!currentUrl) return
    const api = getElectronApi()
    if (!api?.browser) return
    void api.browser.navigate(currentUrl)
    set({ isLoading: true, error: null })
  },

  setWidthRatio: (ratio: number) => {
    const clamped = clampRatio(ratio)
    set({ widthRatio: clamped })
    const api = getElectronApi()
    if (!api?.browser) return
    void api.browser.resize(clamped)
  },

  setCurrentUrl: (url, title, nav) => {
    set({
      currentUrl: url,
      currentTitle: title,
      isLoading: false,
      ...(nav
        ? { canGoBack: nav.canGoBack, canGoForward: nav.canGoForward }
        : {}),
    })
  },

  setLoading: (loading: boolean) => {
    set({ isLoading: loading })
  },

  setError: (error: string | null) => {
    set({ error, isLoading: false })
  },

  toggleFullscreen: () => {
    set((s) => ({ isFullscreen: !s.isFullscreen }))
  },

  noteBackgroundOpen: (conversationId: string, url: string) => {
    set((s) => {
      const next = new Map(s.backgroundSessions)
      next.set(conversationId, url)
      return { backgroundSessions: next }
    })
  },

  // 回收路径有两条：①browserctl close 事件带匹配 conversationId（见 browser-confirmation-host）
  // ②会话删除（见 use-chat-queries 三个删除 mutation 的 onSuccess）。
  // 故意不接 task-end：任务结束不必然关浏览器（面板/内嵌浏览器可在 run 结束后留存供查看），
  // 在 task-end 清标记会误删仍有效的后台标记。
  clearBackground: (conversationId: string) => {
    set((s) => {
      if (!s.backgroundSessions.has(conversationId)) return {}
      const next = new Map(s.backgroundSessions)
      next.delete(conversationId)
      return { backgroundSessions: next }
    })
  },

  adoptForeground: (conversationId: string) => {
    const url = get().backgroundSessions.get(conversationId)
    if (!url) return
    get().openBrowser(url)
    get().setActiveBrowserConversationId(conversationId)
    get().clearBackground(conversationId)
  },

  setActiveBrowserConversationId: (conversationId: string | null) => {
    set({ activeBrowserConversationId: conversationId })
  },

  reset: () => {
    set({
      isOpen: false,
      isMinimized: false,
      isFullscreen: false,
      currentUrl: "",
      currentTitle: "",
      isLoading: false,
      error: null,
      canGoBack: false,
      canGoForward: false,
      activeBrowserConversationId: null,
      // 故意不清 backgroundSessions：其他后台会话的「有浏览器在跑」标记应跨前台
      // reset 留存，否则切走再回来会丢失归属。其回收走按 conversationId 的 close 事件。
    })
  },
}))
