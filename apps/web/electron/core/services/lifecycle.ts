import { app } from "electron"
import { stopBackend } from "../../main/backend"
import { shutdownAuxiliaryWindows } from "../../main/tray"

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
  shutdownAuxiliaryWindows()
  stopBackend()

  setTimeout(() => {
    app.exit(0)
  }, 3000).unref()
}

export function shutdownOnBeforeQuit(): void {
  setForceQuit(true)
  shutdownAuxiliaryWindows()
  stopBackend()
}
