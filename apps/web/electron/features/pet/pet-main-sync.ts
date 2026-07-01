import type { BrowserWindow } from "electron"
import { getSetting } from "../settings/settings-store"
import {
  applyPetAlwaysOnTopFromStore,
  hidePetWindow,
  showPetWindow,
} from "./pet-window"

export function syncPetOnMainForegroundState(mainWin: BrowserWindow): void {
  if (mainWin.isDestroyed()) return
  if (getSetting("petVisibilityMode") !== "when_main_hidden") return
  if (mainWin.isVisible() && !mainWin.isMinimized()) hidePetWindow()
}

export function hidePetIfWhenMainHiddenMode(): void {
  if (getSetting("petVisibilityMode") === "when_main_hidden") hidePetWindow()
}

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
