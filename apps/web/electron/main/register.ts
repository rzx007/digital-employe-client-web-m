import { BrowserWindow, screen } from "electron"
import {
  buildHashRouteUrl,
  getAppIconPath,
  getPreloadPath,
} from "../core/runtime-paths"
import { getWindowManager } from "../core/services/window-registry"

const REGISTER_MIN_HEIGHT = 500
const REGISTER_MAX_HEIGHT_RATIO = 0.92

export function resizeRegisterWindow(size: {
  width: number
  height: number
}): void {
  const registerWin = getWindowManager().get("register")
  if (!registerWin) return
  const workH = screen.getPrimaryDisplay().workArea.height
  const maxH = Math.floor(workH * REGISTER_MAX_HEIGHT_RATIO)
  const w = Math.max(380, Math.round(size.width))
  const h = Math.min(
    maxH,
    Math.max(REGISTER_MIN_HEIGHT, Math.round(size.height)),
  )
  registerWin.setContentSize(w, h)
}

export function createRegisterWindow(_options?: {
  devServerUrl?: string
  indexHtml?: string
}): void {
  const wm = getWindowManager()
  if (wm.focus("register")) return

  const registerWin = new BrowserWindow({
    width: 400,
    height: 640,
    title: "注册",
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

  registerWin.loadURL(buildHashRouteUrl("/register"))

  registerWin.on("closed", () => {
    wm.set("register", null)
  })

  wm.set("register", registerWin)
}

export function closeRegisterWindow(): void {
  const wm = getWindowManager()
  const registerWin = wm.get("register")
  if (!registerWin) return
  registerWin.close()
  wm.set("register", null)
}
