import { app } from "electron"
import { stopBackend } from "../../features/backend/backend-process"
import { deactivateAllExtensions } from "../../features/extension/extension-loader"
import { stopAllExtensionServices } from "../../features/extension/extension-service-host"
import { shutdownAuxiliaryWindows } from "../../features/notification-tray/tray"

let _forceQuit = false

export function isForceQuit(): boolean {
  return _forceQuit
}

export function setForceQuit(value: boolean): void {
  _forceQuit = value
}

/**
 * 退出应用：停止后端与辅助窗口，兜底超时 exit
 */
export function quitApp(): void {
  setForceQuit(true)
  stopAllExtensionServices()
  deactivateAllExtensions()
  shutdownAuxiliaryWindows()
  stopBackend()

  setTimeout(() => {
    app.exit(0)
  }, 3000).unref()
}

export function shutdownOnBeforeQuit(): void {
  setForceQuit(true)
  stopAllExtensionServices()
  deactivateAllExtensions()
  shutdownAuxiliaryWindows()
  stopBackend()
}
