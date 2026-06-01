import {
  BrowserWindow,
  session,
  WebContentsView,
  type Rectangle,
} from "electron"

import type { WebContents } from "electron"

import { getWindowManager } from "../../core/services/window-registry"
import { rootLogger as logger } from "../../core/logger"
import { injectHighlightStyles } from "./browser-highlight"

const PARTITION_NAME = "persist:browser-panel"
const DEFAULT_WIDTH_RATIO = 0.6
const MIN_WIDTH_RATIO = 0.3
const MAX_WIDTH_RATIO = 0.8
const HEADER_OFFSET_Y = 40
const MIN_VIEWPORT_PX = 40
/** 叠在 React 主 WebContents 之上（Windows 需 remove/add 置顶） */
const BROWSER_VIEW_Z_INDEX = 1_000_000

/** Chromium：导航被取消（连续 load / 改 bounds 时常见），勿当网络错误 */
const ERR_ABORTED = -3

function isAbortedLoadMessage(errorCode: number, message: string): boolean {
  if (errorCode === ERR_ABORTED) return true
  const m = message.toLowerCase()
  return m.includes("err_aborted") || m.includes("(-3)")
}

export interface BrowserContentBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserUrlChangeEvent {
  url: string
  title: string
}

export interface BrowserLoadErrorEvent {
  errorCode: number
  errorDescription: string
  url: string
}

function clampWidthRatio(value: number): number {
  if (Number.isNaN(value)) return DEFAULT_WIDTH_RATIO
  return Math.max(MIN_WIDTH_RATIO, Math.min(MAX_WIDTH_RATIO, value))
}

/**
 * 内嵌浏览器：WebContentsView 贴在主窗口 contentView 上。
 *
 * setBounds 与渲染进程 getBoundingClientRect 同坐标系；置顶后避免被 React 层遮挡。
 */
export class BrowserWindowController {
  private widthRatio: number = DEFAULT_WIDTH_RATIO
  private browserView: WebContentsView | null = null
  private mainResizeHandler: (() => void) | null = null
  private viewportBounds: BrowserContentBounds | null = null
  private pendingLoadUrl: string | null = null
  private sessionPrepared = false
  private fallbackLoadTimer: ReturnType<typeof setTimeout> | null = null

  open(url: string): void {
    const wm = getWindowManager()
    const main = wm.get("main")
    if (!main || main.isDestroyed()) {
      logger.warn("[browser] main window not available, cannot open browser panel")
      return
    }

    const view = this.ensureView(main)
    this.pendingLoadUrl = url || null
    this.applyBounds(main)
    this.bringBrowserViewToFront(main)
    view.setVisible(true)
    this.tryStartPendingLoad(main)
    this.scheduleFallbackLoad(main)
    this.attachMainResizeSync(main)
  }

  navigate(url: string): void {
    const wc = this.getBrowserWebContents()
    if (!wc || !url) return
    this.pendingLoadUrl = null
    this.clearFallbackLoadTimer()
    logger.info("[browser] navigate", { url })
    void wc.loadURL(url).catch((err: unknown) => {
      const msg = String(err)
      if (!isAbortedLoadMessage(-1, msg)) {
        this.emitLoadError(url, -1, msg)
      }
    })
  }

  setWidthRatio(ratio: number): void {
    const wm = getWindowManager()
    const main = wm.get("main")
    if (!main || main.isDestroyed()) return

    this.widthRatio = clampWidthRatio(ratio)
    this.applyBounds(main)
    this.bringBrowserViewToFront(main)
  }

  syncBounds(bounds: BrowserContentBounds): void {
    const wm = getWindowManager()
    const main = wm.get("main")
    if (!main || main.isDestroyed()) return

    this.viewportBounds = {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    }

    const view = this.browserView
    if (!view || view.webContents.isDestroyed()) return

    const tooSmall =
      this.viewportBounds.width < MIN_VIEWPORT_PX ||
      this.viewportBounds.height < MIN_VIEWPORT_PX

    if (tooSmall) {
      view.setVisible(false)
      return
    }

    if (!view.getVisible()) view.setVisible(true)
    this.applyBounds(main)
    this.bringBrowserViewToFront(main)
    this.tryStartPendingLoad(main)
  }

  getWidthRatio(): number {
    return this.widthRatio
  }

  hide(): void {
    const view = this.browserView
    if (view && !view.webContents.isDestroyed()) view.setVisible(false)
  }

  show(): void {
    const view = this.browserView
    if (!view || view.webContents.isDestroyed()) return
    const wm = getWindowManager()
    const main = wm.get("main")
    if (main && !main.isDestroyed()) {
      this.applyBounds(main)
      this.bringBrowserViewToFront(main)
    }
    view.setVisible(true)
  }

  close(): void {
    this.clearFallbackLoadTimer()
    this.detachMainResizeSync()
    const wm = getWindowManager()
    const main = wm.get("main")
    const view = this.browserView
    if (view) {
      if (main && !main.isDestroyed()) {
        try {
          main.contentView.removeChildView(view)
        } catch {
          /* already removed */
        }
      }
      if (!view.webContents.isDestroyed()) {
        view.webContents.close()
      }
    }
    this.browserView = null
    this.viewportBounds = null
    this.pendingLoadUrl = null
  }

  isOpen(): boolean {
    const view = this.browserView
    return (
      view !== null &&
      !view.webContents.isDestroyed() &&
      view.getVisible()
    )
  }

  getBrowserWebContents(): WebContents | null {
    const view = this.browserView
    if (!view || view.webContents.isDestroyed()) return null
    return view.webContents
  }

  private ensureView(main: BrowserWindow): WebContentsView {
    if (
      this.browserView &&
      !this.browserView.webContents.isDestroyed()
    ) {
      return this.browserView
    }

    const browserSession = session.fromPartition(PARTITION_NAME)
    this.prepareBrowserSession(browserSession)

    const view = new WebContentsView({
      webPreferences: {
        session: browserSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    })

    view.setBackgroundColor("#ffffff")
    this.browserView = view
    this.bringBrowserViewToFront(main)

    view.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      if (
        targetUrl.startsWith("https:") ||
        targetUrl.startsWith("http:")
      ) {
        if (!main.isDestroyed()) {
          main.webContents.send("browser:request-open", {
            url: targetUrl,
          })
        }
      }
      return { action: "deny" }
    })

    view.webContents.on("destroyed", () => {
      if (this.browserView === view) this.browserView = null
    })

    this.attachEventForwarders(view.webContents, main)

    return view
  }

  private prepareBrowserSession(browserSession: Electron.Session): void {
    if (this.sessionPrepared) return
    this.sessionPrepared = true

    void browserSession.setProxy({ mode: "system" }).catch((err: unknown) => {
      logger.warn("[browser] setProxy(system) failed", { error: String(err) })
    })
  }

  private bringBrowserViewToFront(main: BrowserWindow): void {
    const view = this.browserView
    if (!view || view.webContents.isDestroyed() || main.isDestroyed()) return

    view.setZIndex(BROWSER_VIEW_Z_INDEX)
    try {
      main.contentView.removeChildView(view)
    } catch {
      /* 尚未加入 contentView */
    }
    main.contentView.addChildView(view)
  }

  private hasValidBounds(main: BrowserWindow): boolean {
    const b = this.computeBounds(main)
    return b.width >= MIN_VIEWPORT_PX && b.height >= MIN_VIEWPORT_PX
  }

  private scheduleFallbackLoad(main: BrowserWindow): void {
    this.clearFallbackLoadTimer()
    this.fallbackLoadTimer = setTimeout(() => {
      this.fallbackLoadTimer = null
      if (!this.pendingLoadUrl) return
      if (this.viewportBounds) return
      logger.info("[browser] fallback load (no syncBounds yet)")
      this.tryStartPendingLoad(main)
    }, 300)
  }

  private clearFallbackLoadTimer(): void {
    if (this.fallbackLoadTimer) {
      clearTimeout(this.fallbackLoadTimer)
      this.fallbackLoadTimer = null
    }
  }

  private tryStartPendingLoad(main: BrowserWindow): void {
    const url = this.pendingLoadUrl
    const view = this.browserView
    if (!url || !view || view.webContents.isDestroyed() || main.isDestroyed()) {
      return
    }
    if (!this.hasValidBounds(main)) return

    this.clearFallbackLoadTimer()
    this.pendingLoadUrl = null
    const bounds = this.computeBounds(main)
    logger.info("[browser] loadURL", { url, bounds })

    void view.webContents.loadURL(url).catch((err: unknown) => {
      const msg = String(err)
      if (!isAbortedLoadMessage(-1, msg)) {
        this.emitLoadError(url, -1, msg)
      }
    })
  }

  private emitLoadError(
    url: string,
    errorCode: number,
    errorDescription: string
  ): void {
    if (isAbortedLoadMessage(errorCode, errorDescription)) return
    logger.warn("[browser] load failed", { url, errorCode, errorDescription })
    const main = getWindowManager().get("main")
    if (main && !main.isDestroyed()) {
      main.webContents.send("browser:load-error", {
        errorCode,
        errorDescription,
        url,
      })
    }
  }

  private applyBounds(main: BrowserWindow): void {
    const view = this.browserView
    if (!view || view.webContents.isDestroyed()) return
    view.setBounds(this.computeBounds(main))
  }

  /** contentView 坐标，与 getBoundingClientRect 一致 */
  private computeBounds(main: BrowserWindow): Rectangle {
    const vp = this.viewportBounds
    if (vp && vp.width >= MIN_VIEWPORT_PX && vp.height >= MIN_VIEWPORT_PX) {
      return {
        x: vp.x,
        y: vp.y,
        width: vp.width,
        height: vp.height,
      }
    }

    const [contentWidth, contentHeight] = main.getContentSize()
    const width = Math.round(contentWidth * this.widthRatio)
    return {
      x: contentWidth - width,
      y: HEADER_OFFSET_Y,
      width,
      height: Math.max(0, contentHeight - HEADER_OFFSET_Y),
    }
  }

  private attachEventForwarders(
    wc: WebContents,
    main: BrowserWindow
  ): void {
    const sendUrlChange = () => {
      if (wc.isDestroyed() || main.isDestroyed()) return
      const payload: BrowserUrlChangeEvent = {
        url: wc.getURL(),
        title: wc.getTitle(),
      }
      main.webContents.send("browser:url-change", payload)
    }

    wc.removeAllListeners("did-finish-load")
    wc.on("did-finish-load", () => {
      if (wc.isDestroyed() || main.isDestroyed()) return
      injectHighlightStyles(wc)
      logger.info("[browser] did-finish-load", { url: wc.getURL() })
      sendUrlChange()
    })

    wc.removeAllListeners("did-navigate-in-page")
    wc.on("did-navigate-in-page", () => sendUrlChange())

    wc.removeAllListeners("did-navigate")
    wc.on("did-navigate", () => sendUrlChange())

    wc.removeAllListeners("did-fail-load")
    wc.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || wc.isDestroyed() || main.isDestroyed()) return
        if (errorCode === ERR_ABORTED) return
        logger.warn("[browser] did-fail-load", {
          errorCode,
          errorDescription,
          url: validatedURL,
        })
        main.webContents.send("browser:load-error", {
          errorCode,
          errorDescription,
          url: validatedURL,
        })
      }
    )

    wc.removeAllListeners("page-title-updated")
    wc.on("page-title-updated", () => sendUrlChange())

    wc.removeAllListeners("did-stop-loading")
    wc.on("did-stop-loading", () => {
      logger.info("[browser] did-stop-loading", { url: wc.getURL() })
      sendUrlChange()
    })
  }

  private attachMainResizeSync(main: BrowserWindow): void {
    this.detachMainResizeSync()
    const handler = () => {
      const view = this.browserView
      if (!view || view.webContents.isDestroyed() || !view.getVisible()) return
      this.applyBounds(main)
      this.bringBrowserViewToFront(main)
      if (!main.isDestroyed()) {
        main.webContents.send("browser:layout-changed")
      }
    }
    this.mainResizeHandler = handler
    main.on("resize", handler)
    main.on("move", handler)
  }

  private detachMainResizeSync(): void {
    if (!this.mainResizeHandler) return
    const main = getWindowManager().get("main")
    if (main && !main.isDestroyed()) {
      main.off("resize", this.mainResizeHandler)
      main.off("move", this.mainResizeHandler)
    }
    this.mainResizeHandler = null
  }
}

let browserController: BrowserWindowController | null = null

export function getBrowserController(): BrowserWindowController {
  if (!browserController) {
    browserController = new BrowserWindowController()
  }
  return browserController
}
