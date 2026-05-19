import { flashTray, stopFlashTray } from "../../main/tray"
import { sendNotification } from "../../main/notification"
import { IpcChannels } from "../../shared/ipc-channels"
import type { AppContext } from "../../core/app-context"
import type { IpcContribution } from "../../core/ipc/types"

export const notificationTrayIpcContribution: IpcContribution = {
  id: "notification-tray",
  register(ctx: AppContext) {
    return [
      {
        channel: IpcChannels.flashTray,
        handler: () => flashTray(),
      },
      {
        channel: IpcChannels.stopFlashTray,
        handler: () => stopFlashTray(),
      },
      {
        channel: IpcChannels.sendNotification,
        handler: (
          _event,
          options: { title: string; body: string; silent?: boolean },
        ) => {
          const main = ctx.windowManager.getMain()
          if (!main || main.isDestroyed()) return
          if (!main.isFocused()) {
            sendNotification({ ...options, win: main })
          }
        },
      },
    ]
  },
}
