import { BrowserWindow } from "electron"
import {
  buildHashRouteUrl,
  getAppIconPath,
  getElectronRuntime,
  getPreloadPath,
} from "../core/runtime-paths"
import { getWindowManager } from "../core/services/window-registry"
import { pinBrowserWindowTitle } from "./pin-window-title"

export function createRecruitmentWindow(): void {
  const wm = getWindowManager()
  if (wm.focus("recruitment")) return

  const recruitmentWin = new BrowserWindow({
    width: 960,
    height: 768,
    minWidth: 960,
    minHeight: 768,
    title: "招聘员工",
    icon: getAppIconPath(),
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  pinBrowserWindowTitle(recruitmentWin, "招聘员工")
  recruitmentWin.loadURL(buildHashRouteUrl("/recruitment"))

  if (getElectronRuntime().devServerUrl) {
    recruitmentWin.webContents.openDevTools()
  }

  recruitmentWin.on("closed", () => {
    wm.set("recruitment", null)
  })

  wm.set("recruitment", recruitmentWin)
}

export function closeRecruitmentWindow(): void {
  const wm = getWindowManager()
  const recruitmentWin = wm.get("recruitment")
  if (!recruitmentWin) return
  recruitmentWin.close()
  wm.set("recruitment", null)
}
