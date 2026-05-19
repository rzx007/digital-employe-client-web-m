import { IpcChannels } from "../../shared/ipc-channels"
import { invoke } from "../../preload/invoke"

export const authBridge = {
  loginSuccess: () => invoke(IpcChannels.loginSuccess),
  saveAuth: (
    token: string,
    user: Record<string, unknown>,
    rememberMe: boolean,
  ) => invoke(IpcChannels.saveAuth, { token, user, rememberMe }),
  clearAuth: () => invoke(IpcChannels.clearAuth),
  getAuthStatus: () => invoke(IpcChannels.getAuthStatus),
  hasSavedAuth: () => invoke(IpcChannels.hasSavedAuth),
}
