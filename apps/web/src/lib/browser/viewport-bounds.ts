export interface BrowserViewportRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 测量 BrowserPanel 视口（CSS px，经 IPC 交给主进程）。
 * 主进程须乘以 `webContents.getZoomFactor()` 再 setBounds，见
 * `apps/web/electron/features/browser/README.md`。
 *
 * 高度 = 视口顶到 footer 顶，逻辑须与
 * `electron/features/browser/viewport-bounds.ts` 中脚本一致。
 */
export function measureViewportFromElement(
  viewportEl: HTMLElement
): BrowserViewportRect | null {
  const r = viewportEl.getBoundingClientRect()
  if (r.width < 8 || r.height < 8) return null

  const panel = viewportEl.closest("[data-browser-panel]")
  const footer = panel?.querySelector<HTMLElement>(
    "[data-browser-footer]"
  )

  let height = Math.floor(r.height)
  if (footer) {
    const footerTop = footer.getBoundingClientRect().top
    height = Math.max(0, Math.floor(footerTop - r.top))
  }

  return {
    x: Math.round(r.left),
    y: Math.round(r.top),
    width: Math.max(0, Math.floor(r.width)),
    height,
  }
}
