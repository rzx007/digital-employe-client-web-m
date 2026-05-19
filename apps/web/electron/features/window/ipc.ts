import { showPetWindow } from "../pet/pet-window"
import { IpcChannels } from "../../shared/ipc-channels"
import type { AppContext } from "../../core/app-context"
import type { IpcContribution } from "../../core/ipc/types"
import {
  isForceQuit,
  quitApp,
  setForceQuit,
} from "../../core/services/lifecycle"

export const windowIpcContribution: IpcContribution = {
  id: "window",
  register(ctx: AppContext) {
    const getMain = () => ctx.windowManager.getMain()

    return [
      {
        channel: IpcChannels.quitApp,
        handler: () => quitApp(),
      },
      {
        channel: IpcChannels.minimizeWindow,
        handler: () => getMain()?.minimize(),
      },
      {
        channel: IpcChannels.closeWindow,
        handler: () => {
          getMain()?.hide()
          showPetWindow()
        },
      },
      {
        channel: IpcChannels.maximizeWindow,
        handler: () => {
          const main = getMain()
          if (main?.isMaximized()) main.unmaximize()
          else main?.maximize()
        },
      },
      {
        channel: IpcChannels.isMaximized,
        handler: () => getMain()?.isMaximized() ?? false,
      },
      {
        channel: IpcChannels.setForceQuit,
        handler: (_event, value: unknown) => {
          setForceQuit(Boolean(value))
        },
      },
      {
        channel: IpcChannels.getPlatform,
        handler: () => ({
          isLinux: process.platform === "linux",
          isWin: process.platform === "win32",
          isMac: process.platform === "darwin",
        }),
      },
    ]
  },
}

export { isForceQuit, setForceQuit }
