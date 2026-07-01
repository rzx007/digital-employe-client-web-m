import { app } from "electron"
import { getSetting, setSetting } from "../settings/settings-store"
import { electronApp } from "@electron-toolkit/utils"

export function setAutoLaunch(enabled: boolean): void {
  electronApp.setAutoLaunch(enabled)
  setSetting("autoLaunch", enabled)
}

export function getAutoLaunch(): boolean {
  return getSetting("autoLaunch") ?? false
}
