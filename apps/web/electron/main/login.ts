import { BrowserWindow } from "electron"
import {
  buildHashRouteUrl,
  getAppIconPath,
  getPreloadPath,
} from "../core/runtime-paths"
import { getWindowManager } from "../core/services/window-registry"

export function createLoginWindow(_options?: {
  devServerUrl?: string
  indexHtml?: string
}): void {
  const wm = getWindowManager()
  if (wm.focus("login")) return

  const loginWin = new BrowserWindow({
    width: 310,
    height: 450,
    title: "数字员工",
    icon: getAppIconPath(),
    frame: false,
    resizable: false,
    useContentSize: true,
    center: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: getPreloadPath(),
      zoomFactor: 0.95,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  loginWin.loadURL(buildHashRouteUrl("/login"))

  loginWin.on("closed", () => {
    wm.set("login", null)
  })

  wm.set("login", loginWin)
}

export function closeLoginWindow(): void {
  const wm = getWindowManager()
  const loginWin = wm.get("login")
  if (!loginWin) return
  loginWin.close()
  wm.set("login", null)
}

export function getLoginWin(): BrowserWindow | null {
  return getWindowManager().get("login")
}
