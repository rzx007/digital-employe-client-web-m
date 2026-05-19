import {
  closeLoginWindow,
  createLoginWindow,
} from "../../main/login"
import { closeRecruitmentWindow } from "../../main/recruitment"
import { closeRegisterWindow } from "../../main/register"
import { closeSettingsWindow } from "../../main/settings"
import { shutdownAuxiliaryWindows } from "../../main/tray"
import { saveAuth, clearAuth, getStoredAuth, hasToken } from "../../main/auth"
import { IpcChannels } from "../../shared/ipc-channels"
import type { AppContext } from "../../core/app-context"
import type { IpcContribution } from "../../core/ipc/types"
import { setForceQuit } from "../../core/services/lifecycle"

export const authIpcContribution: IpcContribution = {
  id: "auth",
  register(ctx: AppContext) {
    return [
      {
        channel: IpcChannels.loginSuccess,
        handler: () => {
          closeLoginWindow()
          void ctx.onLoginSuccess()
        },
      },
      {
        channel: IpcChannels.saveAuth,
        handler: (
          _event,
          data: {
            token: string
            user: Record<string, unknown>
            rememberMe: boolean
          },
        ) => {
          saveAuth(data.token, data.user, data.rememberMe)
        },
      },
      {
        channel: IpcChannels.clearAuth,
        handler: () => {
          clearAuth()
          closeSettingsWindow()
          closeRecruitmentWindow()
          closeRegisterWindow()
          shutdownAuxiliaryWindows()
          const main = ctx.windowManager.getMain()
          if (main && !main.isDestroyed()) {
            setForceQuit(true)
            main.close()
            setForceQuit(false)
            ctx.windowManager.set("main", null)
          }
          createLoginWindow()
        },
      },
      {
        channel: IpcChannels.getAuthStatus,
        handler: () => getStoredAuth(),
      },
      {
        channel: IpcChannels.hasSavedAuth,
        handler: () => hasToken(),
      },
    ]
  },
}
