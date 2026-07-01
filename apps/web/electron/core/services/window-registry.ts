import { WindowManager } from "./window-manager"

let windowManager: WindowManager | null = null

export function bindWindowManager(manager: WindowManager): void {
  windowManager = manager
}

export function getWindowManager(): WindowManager {
  if (!windowManager) {
    throw new Error(
      "[WindowManager] not initialized — call bindWindowManager() in main/index before bootstrap",
    )
  }
  return windowManager
}
