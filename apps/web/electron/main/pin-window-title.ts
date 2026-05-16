import type { BrowserWindow } from "electron"

/**
 * 固定 BrowserWindow 标题，避免加载 SPA 后 HTML `<title>` 覆盖 `BrowserWindow` 初始 title。
 */
export function pinBrowserWindowTitle(win: BrowserWindow, title: string): void {
  win.webContents.on("page-title-updated", (event) => {
    event.preventDefault()
    win.setTitle(title)
  })
  win.webContents.once("did-finish-load", () => {
    win.setTitle(title)
  })
}
