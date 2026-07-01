import { closeActivationWindow } from "./window-activation"
import { createLoginWindow } from "../auth/window-login"
import { hasToken } from "../auth/auth-store"
import { isOfflineMode } from "../../core/runtime-env"
import { IpcChannels } from "../../shared/ipc-channels"
import type { AppContext } from "../../core/app-context"
import type { IpcContribution } from "../../core/ipc/types"

export const activationIpcContribution: IpcContribution = {
  id: "activation",
  register(ctx: AppContext) {
    return [
      {
        channel: IpcChannels.activationSuccess,
        handler: () => {
          closeActivationWindow()
          // 激活后按 离线 / 登录态 进入主窗或登录窗（与 bootstrap 同策略）
          if (isOfflineMode() || hasToken()) {
            void ctx.onLoginSuccess()
          } else {
            createLoginWindow()
          }
        },
      },
    ]
  },
}
