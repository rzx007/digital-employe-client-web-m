import { BrowserWindow } from "electron"
import { buildHashRouteUrl, getAppIconPath, getPreloadPath } from "../core/runtime-paths"
import { getWindowManager } from "../core/services/window-registry"
import { pinBrowserWindowTitle } from "./pin-window-title"

export function createSettingsWindow(): void {
  const wm = getWindowManager()
  if (wm.focus("settings")) return

  const settingsWin = new BrowserWindow({
    width: 800,
    height: 600,
    resizable: false,
    title: "数字员工 - 设置",
    icon: getAppIconPath(),
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  pinBrowserWindowTitle(settingsWin, "数字员工 - 设置")
  settingsWin.loadURL(buildHashRouteUrl("/settings"))

  settingsWin.on("closed", () => {
    wm.set("settings", null)
  })

  wm.set("settings", settingsWin)
}

export function closeSettingsWindow(): void {
  const wm = getWindowManager()
  const settingsWin = wm.get("settings")
  if (!settingsWin) return
  settingsWin.close()
  wm.set("settings", null)
}
