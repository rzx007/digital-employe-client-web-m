import { BrowserWindow } from "electron"
import { getWindowManager } from "../../core/services/window-registry"

export function createActivationWindow(): void {
  const wm = getWindowManager()
  if (wm.focus("activation")) return

  wm.createWindow({
    id: "activation",
    route: "/activation",
    overrides: {
      width: 420,
      height: 520,
      title: "应用激活",
      frame: false,
      resizable: false,
      useContentSize: true,
      center: true,
      autoHideMenuBar: true,
      webPreferences: { zoomFactor: 0.95 },
    },
  })
}

export function closeActivationWindow(): void {
  getWindowManager().close("activation")
}

export function getActivationWin(): BrowserWindow | null {
  return getWindowManager().get("activation")
}
