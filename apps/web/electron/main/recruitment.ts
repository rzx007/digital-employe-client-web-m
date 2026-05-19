import { is } from "@electron-toolkit/utils"
import { getWindowManager } from "../core/services/window-registry"
import { pinBrowserWindowTitle } from "./pin-window-title"

export function createRecruitmentWindow(): void {
  const wm = getWindowManager()
  if (wm.focus("recruitment")) return

  const win = wm.createWindow({
    id: "recruitment",
    route: "/recruitment",
    overrides: {
      width: 960,
      height: 768,
      minWidth: 960,
      minHeight: 768,
      title: "招聘员工",
    },
    onCreated: (w) => {
      pinBrowserWindowTitle(w, "招聘员工")
      if (is.dev) w.webContents.openDevTools()
    },
  })
}

export function closeRecruitmentWindow(): void {
  getWindowManager().close("recruitment")
}
