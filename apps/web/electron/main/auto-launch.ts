import { app } from "electron"
import { getSetting, setSetting } from "./settings-store"

export function setAutoLaunch(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
  })
  setSetting("autoLaunch", enabled)
}

export function getAutoLaunch(): boolean {
  return getSetting("autoLaunch") ?? false
}
