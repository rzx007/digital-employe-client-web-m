import * as React from "react"

import { measureViewportFromElement } from "@/lib/browser/viewport-bounds"
import { getElectronApi } from "@/lib/electron/host"

/**
 * 将 BrowserPanel 视口矩形（CSS px）同步给主进程；DIP 换算见
 * apps/web/electron/features/browser/README.md。
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

    const bounds = measureViewportFromElement(el)
    if (!bounds) return

    void api.browser.syncBounds(bounds)
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

    const panel = el.closest("[data-browser-panel]")
    const footer = panel?.querySelector("[data-browser-footer]")
    if (footer) {
      ro.observe(footer)
    }

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
