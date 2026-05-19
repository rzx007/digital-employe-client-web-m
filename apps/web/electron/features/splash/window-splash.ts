import { getWindowManager } from "../../core/services/window-registry"

export function createSplashWindow(): void {
  const wm = getWindowManager()
  if (wm.get("splash")) return

  wm.createWindow({
    id: "splash",
    route: "/splash",
    overrides: {
      width: 400,
      height: 250,
      title: "数字员工",
      frame: false,
      transparent: true,
      resizable: false,
      center: true,
      skipTaskbar: true,
    },
  })
}

export function closeSplashWindow(): void {
  getWindowManager().close("splash")
}

export function notifySplashBackendError(message: string): void {
  const splashWin = getWindowManager().get("splash")
  if (!splashWin) return
  splashWin.webContents.send("backend-error", message)
}
