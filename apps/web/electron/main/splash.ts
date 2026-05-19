import { BrowserWindow } from "electron"
import {
  buildHashRouteUrl,
  getAppIconPath,
  getPreloadPath,
} from "../core/runtime-paths"
import { getWindowManager } from "../core/services/window-registry"

export function createSplashWindow(_options?: {
  devServerUrl?: string
  indexHtml?: string
  preload?: string
}): void {
  const wm = getWindowManager()
  if (wm.get("splash")) return

  const splashWin = new BrowserWindow({
    width: 400,
    height: 250,
    title: "数字员工",
    icon: getAppIconPath(),
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    skipTaskbar: true,
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  splashWin.loadURL(buildHashRouteUrl("/splash"))

  splashWin.on("closed", () => {
    wm.set("splash", null)
  })

  wm.set("splash", splashWin)
}

export function closeSplashWindow(): void {
  const wm = getWindowManager()
  const splashWin = wm.get("splash")
  if (!splashWin) return
  splashWin.close()
  wm.set("splash", null)
}

export function notifySplashBackendError(message: string): void {
  const splashWin = getWindowManager().get("splash")
  if (!splashWin) return
  splashWin.webContents.send("backend-error", message)
}
