import { BrowserWindow, screen } from "electron"
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

export function createRegisterWindow(): void {
  const wm = getWindowManager()
  if (wm.focus("register")) return

  wm.createWindow({
    id: "register",
    route: "/register",
    overrides: {
      width: 400,
      height: 640,
      title: "注册",
      frame: false,
      resizable: false,
      useContentSize: true,
      center: true,
      autoHideMenuBar: true,
      webPreferences: { zoomFactor: 0.95 },
    },
  })
}

export function closeRegisterWindow(): void {
  getWindowManager().close("register")
}
