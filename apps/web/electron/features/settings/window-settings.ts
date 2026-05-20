import { getWindowManager } from "../../core/services/window-registry"
import { buildHashRouteUrl } from "../../core/runtime-paths"
import { pinBrowserWindowTitle } from "../../main/pin-window-title"

const SETTINGS_TABS = new Set([
  "account",
  "general",
  "shortcuts",
  "models",
  "pet",
  "extensions",
  "about",
])

export function buildSettingsRoute(tab?: string): string {
  if (tab && SETTINGS_TABS.has(tab)) {
    return `/settings?tab=${encodeURIComponent(tab)}`
  }
  return "/settings"
}

export function createSettingsWindow(options?: { tab?: string }): void {
  const wm = getWindowManager()
  const route = buildSettingsRoute(options?.tab)
  const existing = wm.get("settings")
  if (existing && !existing.isDestroyed()) {
    void existing.loadURL(buildHashRouteUrl(route))
    existing.focus()
    return
  }

  const win = wm.createWindow({
    id: "settings",
    route,
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
