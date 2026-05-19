import { IpcChannels } from "../../shared/ipc-channels"
import { invoke, onChannelAll } from "../../preload/invoke"

export const recruitmentBridge = {
  openRecruitment: () => invoke(IpcChannels.openRecruitment),
  closeRecruitment: () => invoke(IpcChannels.closeRecruitment),
  notifyHireSuccess: () => invoke(IpcChannels.hireSuccess),
  openRegister: () => invoke(IpcChannels.openRegister),
  closeRegister: () => invoke(IpcChannels.closeRegister),
  notifyRegisterSuccess: (username: string) =>
    invoke(IpcChannels.registerSuccess, username),
  onRegisterSuccess: (callback: (username: string) => void) =>
    onChannelAll("register-success", (username) =>
      callback(username as string),
    ),
  resizeRegisterWindow: (size: { width: number; height: number }) =>
    invoke(IpcChannels.resizeRegisterWindow, size),
  onInvalidateContacts: (callback: () => void) =>
    onChannelAll("invalidate-contacts", () => callback()),
  onInvalidateModelConfig: (callback: () => void) =>
    onChannelAll("invalidate-model-config", () => callback()),
}
