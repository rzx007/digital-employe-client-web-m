import * as React from "react"

import { getElectronApi } from "@/lib/electron/host"

export interface BrowserViewportRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 将 BrowserPanel 内「网页视口」的 DOM 矩形同步给主进程 WebContentsView（与 getBoundingClientRect 同坐标系）。
 */
export function useBrowserViewportSync(
  viewportRef: React.RefObject<HTMLElement | null>,
  enabled: boolean
) {
  const rafRef = React.useRef<number | null>(null)

  const pushBounds = React.useCallback(() => {
    const el = viewportRef.current
    const api = getElectronApi()
    if (!el || !api?.browser?.syncBounds) return

    const rect = el.getBoundingClientRect()
    if (rect.width < 8 || rect.height < 8) return

    void api.browser.syncBounds({
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    })
  }, [viewportRef])

  const scheduleSync = React.useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      pushBounds()
    })
  }, [pushBounds])

  React.useLayoutEffect(() => {
    if (!enabled) return
    scheduleSync()

    const el = viewportRef.current
    if (!el) return

    const ro = new ResizeObserver(() => scheduleSync())
    ro.observe(el)

    const onLayout = () => scheduleSync()
    window.addEventListener("resize", onLayout)
    window.addEventListener("scroll", onLayout, true)

    const api = getElectronApi()
    const unsubLayout = api?.browser?.onLayoutChanged?.(onLayout)

    return () => {
      ro.disconnect()
      window.removeEventListener("resize", onLayout)
      window.removeEventListener("scroll", onLayout, true)
      unsubLayout?.()
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [enabled, viewportRef, scheduleSync])
}
