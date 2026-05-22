import { BrowserWindow } from "electron"
import { getWindowManager } from "../../core/services/window-registry"

export function createLoginWindow(): void {
  const wm = getWindowManager()
  if (wm.focus("login")) return

  wm.createWindow({
    id: "login",
    route: "/login",
    overrides: {
      width: 310,
      height: 450,
      title: "数字员工",
      frame: false,
      resizable: false,
      useContentSize: true,
      center: true,
      autoHideMenuBar: true,
      webPreferences: { zoomFactor: 0.95 },
    },
  })
}

export function closeLoginWindow(): void {
  getWindowManager().close("login")
}

export function getLoginWin(): BrowserWindow | null {
  return getWindowManager().get("login")
}
