import {
  BrowserWindow,
  session,
  View,
  WebContentsView,
  type Rectangle,
} from "electron"

import type { WebContents } from "electron"

import { getWindowManager } from "../../core/services/window-registry"
import { rootLogger as logger } from "../../core/logger"
import { injectHighlightStyles } from "./browser-highlight"
import {
  cssViewportBoxToDipBounds,
  MEASURE_BROWSER_VIEWPORT_SCRIPT,
} from "./viewport-bounds"

const PARTITION_NAME = "persist:browser-panel"
const DEFAULT_WIDTH_RATIO = 0.6
const MIN_WIDTH_RATIO = 0.3
const MAX_WIDTH_RATIO = 0.8
const HEADER_OFFSET_Y = 40
const MIN_VIEWPORT_PX = 40

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
  canGoBack: boolean
  canGoForward: boolean
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
 * 内嵌浏览器：contentView → 裁剪容器 View → WebContentsView(0,0)。
 * 视口对齐见本目录 README.md。
 */
export class BrowserWindowController {
  private widthRatio: number = DEFAULT_WIDTH_RATIO
  private browserView: WebContentsView | null = null
  private browserContainer: View | null = null
  private mainResizeHandler: (() => void) | null = null
  private viewportBounds: BrowserContentBounds | null = null
  private pendingLoadUrl: string | null = null
  private sessionPrepared = false
  private fallbackLoadTimer: ReturnType<typeof setTimeout> | null = null
  private lastMeasuredBounds: BrowserContentBounds | null = null
  private stableBoundsCount = 0
  // 锁定隐藏：确认弹窗等需 React 层置顶时设 true，期间所有重新显示路径都被拦
  private visibilitySuppressed = false

  open(url: string): void {
    const wm = getWindowManager()
    const main = wm.get("main")
    if (!main || main.isDestroyed()) {
      logger.warn("[browser] main window not available, cannot open browser panel")
      return
    }

    const view = this.ensureView(main)
    this.pendingLoadUrl = url || null
    this.lastMeasuredBounds = null
    this.stableBoundsCount = 0
    view.setVisible(false)
    this.attachBrowserSubview(main)
    void this.applyViewportLayout(main)
    this.scheduleFallbackLayout(main)
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

  goBack(): void {
    const wc = this.getBrowserWebContents()
    if (!wc) return
    const nav = wc.navigationHistory
    if (!nav.canGoBack()) return
    this.pendingLoadUrl = null
    this.clearFallbackLoadTimer()
    nav.goBack()
  }

  goForward(): void {
    const wc = this.getBrowserWebContents()
    if (!wc) return
    const nav = wc.navigationHistory
    if (!nav.canGoForward()) return
    this.pendingLoadUrl = null
    this.clearFallbackLoadTimer()
    nav.goForward()
  }

  /**
   * Agent HTTP 桥接：轮询布局视口直至可 setBounds（不依赖 stableBounds / pendingLoadUrl）。
   */
  async prepareViewportForBridge(): Promise<WebContents> {
    const wm = getWindowManager()
    const main = wm.get("main")
    if (!main || main.isDestroyed()) {
      throw new Error("BROWSER_UNAVAILABLE")
    }

    this.pendingLoadUrl = null
    this.clearFallbackLoadTimer()

    const view = this.ensureView(main)
    view.setVisible(false)
    this.attachBrowserSubview(main)

    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      await this.applyViewportLayout(main)
      if (this.hasValidBounds()) break
      await new Promise((r) => setTimeout(r, 80))
    }

    if (!this.hasValidBounds()) {
      throw new Error("BROWSER_VIEWPORT_NOT_READY")
    }

    view.setVisible(true)
    this.applyBounds(main)
    this.attachBrowserSubview(main)

    const wc = this.getBrowserWebContents()
    if (!wc || wc.isDestroyed()) {
      throw new Error("BROWSER_UNAVAILABLE")
    }
    return wc
  }

  setWidthRatio(ratio: number): void {
    const wm = getWindowManager()
    const main = wm.get("main")
    if (!main || main.isDestroyed()) return

    this.widthRatio = clampWidthRatio(ratio)
    void this.applyViewportLayout(main)
  }

  syncBounds(bounds: BrowserContentBounds): void {
    const wm = getWindowManager()
    const main = wm.get("main")
    if (!main || main.isDestroyed()) return

    this.viewportBounds = this.cssBoundsToDip(main, bounds)
    void this.applyViewportLayout(main)
  }

  getWidthRatio(): number {
    return this.widthRatio
  }

  hide(): void {
    const view = this.browserView
    if (view && !view.webContents.isDestroyed()) view.setVisible(false)
  }

  show(): void {
    if (this.visibilitySuppressed) return
    const view = this.browserView
    if (!view || view.webContents.isDestroyed()) return
    const wm = getWindowManager()
    const main = wm.get("main")
    if (main && !main.isDestroyed()) {
      this.applyBounds(main)
      this.attachBrowserSubview(main)
    }
    view.setVisible(true)
  }

  /**
   * 锁定/解锁内嵌浏览器视图的隐藏。锁定期间所有重新显示路径
   * （applyViewportLayout via syncBounds/resize、show）都被拦，
   * 用于让 React 确认弹窗在原生合成层之上可见。
   */
  setVisibilitySuppressed(suppressed: boolean): void {
    this.visibilitySuppressed = suppressed
    const view = this.browserView
    if (!view || view.webContents.isDestroyed()) return
    if (suppressed) {
      view.setVisible(false)
      return
    }
    const main = getWindowManager().get("main")
    if (main && !main.isDestroyed()) {
      this.applyBounds(main)
      this.attachBrowserSubview(main)
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
        this.detachBrowserSubview(main)
      }
      if (!view.webContents.isDestroyed()) {
        view.webContents.close()
      }
    }
    this.browserView = null
    this.browserContainer = null
    this.viewportBounds = null
    this.pendingLoadUrl = null
    this.lastMeasuredBounds = null
    this.stableBoundsCount = 0
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
    this.browserContainer = new View()
    this.attachBrowserSubview(main)

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

  private detachBrowserSubview(main: BrowserWindow): void {
    const view = this.browserView
    const container = this.browserContainer
    if (!view && !container) return

    if (container && view) {
      try {
        container.removeChildView(view)
      } catch {
        /* not a child */
      }
    }

    if (view) {
      try {
        main.contentView.removeChildView(view)
      } catch {
        /* not a direct child */
      }
    }

    if (container) {
      try {
        main.contentView.removeChildView(container)
      } catch {
        /* not a direct child */
      }
    }
  }

  private attachBrowserSubview(main: BrowserWindow): void {
    const view = this.browserView
    const container = this.browserContainer
    if (
      !view ||
      !container ||
      view.webContents.isDestroyed() ||
      main.isDestroyed()
    ) {
      return
    }

    this.detachBrowserSubview(main)
    main.contentView.addChildView(container)
    container.addChildView(view)
  }

  private hasValidBounds(): boolean {
    const vp = this.viewportBounds
    return (
      vp !== null &&
      vp.width >= MIN_VIEWPORT_PX &&
      vp.height >= MIN_VIEWPORT_PX
    )
  }

  private scheduleFallbackLayout(main: BrowserWindow): void {
    this.clearFallbackLoadTimer()
    this.fallbackLoadTimer = setTimeout(() => {
      this.fallbackLoadTimer = null
      void this.applyViewportLayout(main)
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
    if (!this.hasValidBounds() || this.stableBoundsCount < 2) return

    this.clearFallbackLoadTimer()
    this.pendingLoadUrl = null
    logger.info("[browser] loadURL", { url })

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

  private cssBoundsToDip(
    main: BrowserWindow,
    bounds: BrowserContentBounds
  ): BrowserContentBounds {
    return cssViewportBoxToDipBounds(
      {
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      main.webContents.getZoomFactor()
    )
  }

  private async pullBoundsFromDom(
    main: BrowserWindow
  ): Promise<BrowserContentBounds | null> {
    if (main.isDestroyed() || main.webContents.isDestroyed()) return null
    try {
      const raw = await main.webContents.executeJavaScript(
        MEASURE_BROWSER_VIEWPORT_SCRIPT
      )
      if (
        !raw ||
        typeof raw !== "object" ||
        typeof (raw as { left?: unknown }).left !== "number" ||
        typeof (raw as { top?: unknown }).top !== "number" ||
        typeof (raw as { width?: unknown }).width !== "number" ||
        typeof (raw as { height?: unknown }).height !== "number"
      ) {
        return null
      }
      return cssViewportBoxToDipBounds(
        raw as {
          left: number
          top: number
          width: number
          height: number
        },
        main.webContents.getZoomFactor()
      )
    } catch (err) {
      logger.warn("[browser] pullBoundsFromDom failed", {
        error: String(err),
      })
      return null
    }
  }

  private noteBoundsStability(next: BrowserContentBounds): void {
    const prev = this.lastMeasuredBounds
    const stable =
      prev !== null &&
      prev.x === next.x &&
      prev.y === next.y &&
      prev.width === next.width &&
      prev.height === next.height
    this.lastMeasuredBounds = next
    this.stableBoundsCount = stable ? this.stableBoundsCount + 1 : 1
  }

  private async applyViewportLayout(main: BrowserWindow): Promise<void> {
    const dom = await this.pullBoundsFromDom(main)
    if (dom && dom.width >= MIN_VIEWPORT_PX && dom.height >= MIN_VIEWPORT_PX) {
      this.viewportBounds = dom
      this.noteBoundsStability(dom)
    }

    const view = this.browserView
    if (!view || view.webContents.isDestroyed()) return

    const vp = this.viewportBounds
    const tooSmall =
      !vp ||
      vp.width < MIN_VIEWPORT_PX ||
      vp.height < MIN_VIEWPORT_PX

    if (tooSmall) {
      view.setVisible(false)
      return
    }

    if (this.visibilitySuppressed) {
      view.setVisible(false)
      return
    }

    if (!view.getVisible()) view.setVisible(true)
    this.applyBounds(main)
    this.attachBrowserSubview(main)
    this.tryStartPendingLoad(main)
  }

  private applyBounds(main: BrowserWindow): void {
    const view = this.browserView
    const container = this.browserContainer
    if (!view || !container || view.webContents.isDestroyed()) return

    const bounds = this.computeBounds(main)
    container.setBounds(bounds)
    view.setBounds({
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height,
    })
  }

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
      const nav = wc.navigationHistory
      const payload: BrowserUrlChangeEvent = {
        url: wc.getURL(),
        title: wc.getTitle(),
        canGoBack: nav.canGoBack(),
        canGoForward: nav.canGoForward(),
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
    wc.on("did-stop-loading", () => sendUrlChange())
  }

  private attachMainResizeSync(main: BrowserWindow): void {
    this.detachMainResizeSync()
    const handler = () => {
      const view = this.browserView
      if (!view || view.webContents.isDestroyed() || !view.getVisible()) return
      void this.applyViewportLayout(main)
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
