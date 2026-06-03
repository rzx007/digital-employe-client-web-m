import type { WebContents } from "electron"

const HIGHLIGHT_CSS = `
.__browser_highlight_ring {
  outline: 3px solid #facc15 !important;
  outline-offset: 2px !important;
  border-radius: 4px !important;
  transition: outline 0.2s ease-in-out !important;
  pointer-events: none !important;
  z-index: 999999 !important;
}
`

const injectedSessions = new WeakSet<WebContents>()

export function injectHighlightStyles(webContents: WebContents): void {
  if (webContents.isDestroyed() || injectedSessions.has(webContents)) return
  injectedSessions.add(webContents)
  void webContents.insertCSS(HIGHLIGHT_CSS).catch(() => {})
}

export async function flashHighlight(
  webContents: WebContents,
  selector: string,
  durationMs = 3000
): Promise<void> {
  if (webContents.isDestroyed() || !selector || selector.startsWith("@e")) {
    return
  }
  injectHighlightStyles(webContents)
  const escaped = selector.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
  try {
    await webContents.executeJavaScript(`
      (() => {
        const el = document.querySelector('${escaped}')
        if (!el) return false
        el.classList.add('__browser_highlight_ring')
        setTimeout(() => el.classList.remove('__browser_highlight_ring'), ${durationMs})
        return true
      })()
    `)
  } catch {
    /* ignore */
  }
}
