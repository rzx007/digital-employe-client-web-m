import {
  createRecruitmentWindow,
  closeRecruitmentWindow,
} from "../../main/recruitment"
import {
  createRegisterWindow,
  closeRegisterWindow,
  resizeRegisterWindow,
} from "../../main/register"
import { getLoginWin } from "../../main/login"
import { IpcChannels } from "../../shared/ipc-channels"
import type { AppContext } from "../../core/app-context"
import type { IpcContribution } from "../../core/ipc/types"

export const recruitmentIpcContribution: IpcContribution = {
  id: "recruitment",
  register(ctx: AppContext) {
    return [
      {
        channel: IpcChannels.openRecruitment,
        handler: () => createRecruitmentWindow(),
      },
      {
        channel: IpcChannels.closeRecruitment,
        handler: () => closeRecruitmentWindow(),
      },
      {
        channel: IpcChannels.hireSuccess,
        handler: () => {
          const main = ctx.windowManager.getMain()
          if (main && !main.isDestroyed()) {
            main.webContents.send("invalidate-contacts")
          }
        },
      },
      {
        channel: IpcChannels.openRegister,
        handler: () => createRegisterWindow(),
      },
      {
        channel: IpcChannels.closeRegister,
        handler: () => closeRegisterWindow(),
      },
      {
        channel: IpcChannels.registerSuccess,
        handler: (_event, username: unknown) => {
          const win = getLoginWin()
          if (win && !win.isDestroyed()) {
            win.webContents.send("register-success", username)
          }
          closeRegisterWindow()
        },
      },
      {
        channel: IpcChannels.resizeRegisterWindow,
        handler: (_event, size: unknown) => {
          resizeRegisterWindow(size as { width: number; height: number })
        },
      },
    ]
  },
}
