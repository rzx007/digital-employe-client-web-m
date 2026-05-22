import { IpcChannels } from "../../shared/ipc-channels"
import { invoke } from "../../preload/invoke"

export const windowBridge = {
  quitApp: () => invoke(IpcChannels.quitApp),
  minimizeWindow: () => invoke(IpcChannels.minimizeWindow),
  closeWindow: () => invoke(IpcChannels.closeWindow),
  maximizeWindow: () => invoke(IpcChannels.maximizeWindow),
  isMaximized: () => invoke(IpcChannels.isMaximized),
  setForceQuit: (value: boolean) => invoke(IpcChannels.setForceQuit, value),
  getPlatform: () => invoke(IpcChannels.getPlatform),
}
