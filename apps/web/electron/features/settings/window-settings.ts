import { getWindowManager } from "../../core/services/window-registry"
import { pinBrowserWindowTitle } from "../../main/pin-window-title"

export function createSettingsWindow(): void {
  const wm = getWindowManager()
  if (wm.focus("settings")) return

  const win = wm.createWindow({
    id: "settings",
    route: "/settings",
    overrides: {
      width: 800,
      height: 600,
      resizable: false,
      title: "数字员工 - 设置",
    },
  })

  pinBrowserWindowTitle(win, "数字员工 - 设置")
}

export function closeSettingsWindow(): void {
  getWindowManager().close("settings")
}
