import { getWindowManager } from "../../core/services/window-registry"
import { pinBrowserWindowTitle } from "../../main/pin-window-title"

export function createRecruitmentWindow(): void {
  const wm = getWindowManager()
  if (wm.focus("recruitment")) return

  wm.createWindow({
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
    },
  })
}

export function closeRecruitmentWindow(): void {
  getWindowManager().close("recruitment")
}
