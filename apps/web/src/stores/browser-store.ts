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
    // 去虚拟前缀后静态服务按真实路径查询参数提供（后端会话根沙箱校验）
    const url = `${base}/chat/conversations/${conversationId}/resources/static?path=${encodeURIComponent(
      realPath
    )}`
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
    })
  },
}))
