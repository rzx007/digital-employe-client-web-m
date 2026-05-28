import { IpcChannels } from "../../shared/ipc-channels"
import { invoke } from "../../preload/invoke"

export const settingsBridge = {
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
  getOnboardingCompleted: () => invoke(IpcChannels.getOnboardingCompleted),
  setOnboardingCompleted: (value: boolean) =>
    invoke(IpcChannels.setOnboardingCompleted, value),
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
}
