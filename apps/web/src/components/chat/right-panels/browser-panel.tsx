import * as React from "react"
import {
  IconArrowLeft,
  IconArrowRight,
  IconWorld,
  IconRefresh,
  IconMinus,
  IconMaximize,
  IconMinimize,
  IconX,
} from "@tabler/icons-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

import { BrowserCloseConfirmDialog } from "@/components/chat/right-panels/browser-close-confirm-dialog"
import { useBrowserViewportSync } from "@/hooks/use-browser-viewport-sync"
import { isBrowserCloseConfirmDismissed } from "@/lib/browser/close-confirm"
import { formatBrowserLoadError } from "@/lib/browser/load-error-message"
import { getElectronApi } from "@/lib/electron/host"
import { useBrowserStore } from "@/stores/browser-store"

const LOAD_TIMEOUT_MS = 25_000

export function BrowserPanel() {
  const {
    isOpen,
    currentUrl,
    currentTitle,
    isLoading,
    isFullscreen,
    error,
    canGoBack,
    canGoForward,
    minimizeBrowser,
    destroyBrowser,
    navigate,
    goBack,
    goForward,
    refresh,
    setCurrentUrl,
    setError,
    toggleFullscreen,
  } = useBrowserStore()

  const viewportRef = React.useRef<HTMLDivElement>(null)
  const [urlInput, setUrlInput] = React.useState(currentUrl)
  const [closeConfirmOpen, setCloseConfirmOpen] = React.useState(false)

  const handleCloseClick = () => {
    if (isBrowserCloseConfirmDismissed()) {
      destroyBrowser()
      return
    }
    setCloseConfirmOpen(true)
  }

  /** WebContentsView 在 contentView 原生层，会盖住 React 弹窗；确认期间临时隐藏 */
  React.useEffect(() => {
    if (!isOpen) return
    const api = getElectronApi()
    if (!api?.browser) return
    if (closeConfirmOpen) {
      void api.browser.hide()
      return
    }
    void api.browser.show()
  }, [closeConfirmOpen, isOpen])

  useBrowserViewportSync(viewportRef, isOpen)

  React.useEffect(() => {
    if (!isFullscreen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") toggleFullscreen()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isFullscreen, toggleFullscreen])

  React.useEffect(() => {
    setUrlInput(currentUrl)
  }, [currentUrl])

  React.useEffect(() => {
    if (!isOpen) return
    const api = getElectronApi()
    if (!api?.browser) return
    const unsubUrl = api.browser.onUrlChange((data) => {
      setCurrentUrl(data.url, data.title, {
        canGoBack: data.canGoBack,
        canGoForward: data.canGoForward,
      })
    })
    const unsubError = api.browser.onLoadError((data) => {
      const message = formatBrowserLoadError(
        data.errorCode,
        data.errorDescription
      )
      if (message) setError(message)
    })
    return () => {
      unsubUrl()
      unsubError()
    }
  }, [isOpen, setCurrentUrl, setError])

  React.useEffect(() => {
    if (!isOpen || !isLoading) return
    const timer = window.setTimeout(() => {
      const { isLoading: loading } = useBrowserStore.getState()
      if (!loading) return
      useBrowserStore.getState().setError(
        "加载超时：若系统浏览器可打开而此处不行，请完全重启 Electron 后再试；也可能是公司代理未对内嵌会话生效"
      )
    }, LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [isOpen, isLoading, currentUrl])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (urlInput.trim()) navigate(urlInput)
  }

  if (!isOpen) return null

  return (
    <div
      data-browser-panel
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-background shadow-sm"
    >
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-2 py-2">
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={goBack}
            disabled={!canGoBack}
            title="后退"
          >
            <IconArrowLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={goForward}
            disabled={!canGoForward}
            title="前进"
          >
            <IconArrowRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={refresh}
            title="刷新"
          >
            <IconRefresh
              className={cn("h-3.5 w-3.5", isLoading && "animate-spin")}
            />
          </Button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex min-w-0 flex-1 flex-col gap-0.5"
        >
          <Input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="输入 URL 后回车"
            className="h-7 text-xs"
          />
          {currentTitle ? (
            <p className="truncate px-1 text-[10px] text-muted-foreground">
              {currentTitle}
            </p>
          ) : null}
        </form>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={minimizeBrowser}
          title="最小化浏览器"
        >
          <IconMinus className="h-3.5 w-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={toggleFullscreen}
          title={isFullscreen ? "退出全屏 (Esc)" : "全屏"}
        >
          {isFullscreen ? (
            <IconMinimize className="h-3.5 w-3.5" />
          ) : (
            <IconMaximize className="h-3.5 w-3.5" />
          )}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={handleCloseClick}
          title="关闭并销毁浏览器"
        >
          <IconX className="h-3.5 w-3.5" />
        </Button>
      </div>

      <BrowserCloseConfirmDialog
        open={closeConfirmOpen}
        onOpenChange={setCloseConfirmOpen}
        onConfirm={destroyBrowser}
      />

      {error && (
        <div className="shrink-0 border-b bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* WebContentsView 对齐此区域（主进程 syncBounds） */}
      <div
        ref={viewportRef}
        data-browser-viewport
        className="relative min-h-[160px] flex-1 bg-transparent"
      >
        {isLoading ? (
          <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
            <span className="rounded-md bg-muted/80 px-2 py-0.5 text-[10px] text-muted-foreground">
              页面加载中…
            </span>
          </div>
        ) : !currentUrl ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
            <IconWorld className="h-8 w-8 opacity-25" />
            <p className="text-xs opacity-60">输入 URL 开始浏览</p>
          </div>
        ) : null}
      </div>

      <div
        data-browser-footer
        className="shrink-0 truncate border-t bg-muted/20 px-3 py-1.5 font-mono text-[10px] text-muted-foreground"
      >
        {currentUrl || "未加载 URL"}
      </div>
    </div>
  )
}
