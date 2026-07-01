import { IpcChannels } from "../../shared/ipc-channels"
import { invoke, onChannelAll } from "../../preload/invoke"

export const settingsBridge = {
  /** 头像上传成功后调用：主进程会把 avatar-updated 广播给所有窗口 */
  broadcastAvatarUpdated: () => invoke(IpcChannels.broadcastAvatarUpdated),
  /** 订阅头像更新广播，回调里通常 bumpAvatarVersion() 触发本窗口头像重取 */
  onAvatarUpdated: (callback: () => void) =>
    onChannelAll("avatar-updated", () => callback()),
  /** 外观（浅色/深色/主题色）变更后广播给所有窗口 */
  broadcastThemeChanged: () => invoke(IpcChannels.broadcastThemeChanged),
  onThemeChanged: (callback: () => void) =>
    onChannelAll("theme-changed", () => callback()),
  openSettings: () => invoke(IpcChannels.openSettings),
  closeSettings: () => invoke(IpcChannels.closeSettings),
  setAutoLaunch: (enabled: boolean) =>
    invoke(IpcChannels.setAutoLaunch, enabled),
  getAutoLaunch: () => invoke(IpcChannels.getAutoLaunch),
  setNotifications: (enabled: boolean) =>
    invoke(IpcChannels.setNotifications, enabled),
  getNotifications: () => invoke(IpcChannels.getNotifications),
  setAutoUpdate: (enabled: boolean) =>
    invoke(IpcChannels.setAutoUpdate, enabled),
  getAutoUpdate: () => invoke(IpcChannels.getAutoUpdate),
  getPetSettings: () => invoke(IpcChannels.getPetSettings),
  setPetSettings: (partial: {
    petEnabled?: boolean
    petVisibilityMode?: "always" | "when_main_hidden"
    petAlwaysOnTop?: boolean
  }) => invoke(IpcChannels.setPetSettings, partial),
  getEndpoint: () => invoke(IpcChannels.getEndpoint),
  setEndpoint: (endpoint: string) => invoke(IpcChannels.setEndpoint, endpoint),
  getModelSettings: () => invoke(IpcChannels.getModelSettings),
  setModelSettings: (data: {
    model: string
    apiKey: string
    apiUrl: string
  }) => invoke(IpcChannels.setModelSettings, data),
  resetApp: () => invoke(IpcChannels.resetApp),
  openLogsDirectory: () => invoke(IpcChannels.openLogsDirectory),
  exportLogs: () => invoke(IpcChannels.exportLogs),
  revealPathInExplorer: (
    path: string,
    entryType: "file" | "directory"
  ) => invoke(IpcChannels.revealPathInExplorer, path, entryType),
  selectDirectory: () => invoke(IpcChannels.selectDirectory),
}
