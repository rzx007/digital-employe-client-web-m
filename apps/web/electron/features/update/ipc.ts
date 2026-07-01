import {
  checkForUpdatesFromMenu,
  triggerDownloadUpdate,
  quitAndInstallUpdate,
} from "./auto-updater"
import { IpcChannels } from "../../shared/ipc-channels"
import type { IpcContribution } from "../../core/ipc/types"

export const updateIpcContribution: IpcContribution = {
  id: "update",
  register() {
    return [
      {
        channel: IpcChannels.checkUpdate,
        handler: () => checkForUpdatesFromMenu(),
      },
      {
        channel: IpcChannels.startDownload,
        handler: () => triggerDownloadUpdate(),
      },
      {
        channel: IpcChannels.quitAndInstall,
        handler: () => quitAndInstallUpdate(),
      },
    ]
  },
}
