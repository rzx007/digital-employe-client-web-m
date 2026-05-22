import { IpcChannels } from "../../shared/ipc-channels"
import { invoke } from "../../preload/invoke"

export const notificationTrayBridge = {
  flashTray: () => invoke(IpcChannels.flashTray),
  stopFlashTray: () => invoke(IpcChannels.stopFlashTray),
  sendNotification: (title: string, body: string, silent?: boolean) =>
    invoke(IpcChannels.sendNotification, { title, body, silent }),
}
