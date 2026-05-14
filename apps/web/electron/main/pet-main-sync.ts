import type { BrowserWindow } from "electron"
import { getSetting } from "./settings-store"
import {
  applyPetAlwaysOnTopFromStore,
  hidePetWindow,
  showPetWindow,
} from "./pet"

/**
 * 主窗口处于「前台可见且非最小化」时，按策略隐藏宠物（仅 when_main_hidden）。
 */
export function syncPetOnMainForegroundState(mainWin: BrowserWindow): void {
  if (mainWin.isDestroyed()) return
  if (getSetting("petVisibilityMode") !== "when_main_hidden") return
  if (mainWin.isVisible() && !mainWin.isMinimized()) hidePetWindow()
}

/**
 * 从托盘/二次启动等唤起主窗口时：仅在 when_main_hidden 下隐藏宠物。
 */
export function hidePetIfWhenMainHiddenMode(): void {
  if (getSetting("petVisibilityMode") === "when_main_hidden") hidePetWindow()
}

/**
 * 设置变更或启动后根据主窗口状态同步宠物显隐与置顶。
 */
export function syncPetVisibilityWithMain(mainWin: BrowserWindow | null): void {
  applyPetAlwaysOnTopFromStore()
  if (!getSetting("petEnabled")) {
    hidePetWindow()
    return
  }
  const mode = getSetting("petVisibilityMode")
  if (!mainWin || mainWin.isDestroyed()) {
    if (mode === "always") showPetWindow()
    return
  }
  const mainInForeground = mainWin.isVisible() && !mainWin.isMinimized()
  if (mode === "when_main_hidden") {
    if (mainInForeground) hidePetWindow()
    else showPetWindow()
  } else {
    showPetWindow()
  }
}
