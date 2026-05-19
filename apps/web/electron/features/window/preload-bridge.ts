import { IpcChannels } from "../../shared/ipc-channels"
import { invoke } from "../../preload/invoke"

export const windowBridge = {
  quitApp: () => invoke(IpcChannels.quitApp),
  minimizeWindow: () => invoke(IpcChannels.minimizeWindow),
  closeWindow: () => invoke(IpcChannels.closeWindow),
  maximizeWindow: () => invoke(IpcChannels.maximizeWindow),
  isMaximized: () => invoke<boolean>(IpcChannels.isMaximized),
  setForceQuit: (value: boolean) => invoke(IpcChannels.setForceQuit, value),
  getPlatform: () =>
    invoke<{ isLinux: boolean; isWin: boolean; isMac: boolean }>(
      IpcChannels.getPlatform,
    ),
}
