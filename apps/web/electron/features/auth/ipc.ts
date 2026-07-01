import {
  closeLoginWindow,
  createLoginWindow,
} from "./window-login"
import { closeRecruitmentWindow } from "../recruitment/window-recruitment"
import { closeRegisterWindow } from "./window-register"
import { closeSettingsWindow } from "../settings/window-settings"
import { shutdownAuxiliaryWindows } from "../notification-tray/tray"
import { saveAuth, clearAuth, getStoredAuth, hasToken } from "./auth-store"
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
