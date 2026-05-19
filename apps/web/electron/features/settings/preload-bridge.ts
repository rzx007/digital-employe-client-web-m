import { IpcChannels } from "../../shared/ipc-channels"
import { invoke } from "../../preload/invoke"

export const settingsBridge = {
  openSettings: () => invoke(IpcChannels.openSettings),
  closeSettings: () => invoke(IpcChannels.closeSettings),
  setAutoLaunch: (enabled: boolean) =>
    invoke(IpcChannels.setAutoLaunch, enabled),
  getAutoLaunch: () => invoke<boolean>(IpcChannels.getAutoLaunch),
  setNotifications: (enabled: boolean) =>
    invoke(IpcChannels.setNotifications, enabled),
  getNotifications: () => invoke<boolean>(IpcChannels.getNotifications),
  setAutoUpdate: (enabled: boolean) =>
    invoke(IpcChannels.setAutoUpdate, enabled),
  getAutoUpdate: () => invoke<boolean>(IpcChannels.getAutoUpdate),
  getPetSettings: () =>
    invoke<{
      petEnabled: boolean
      petVisibilityMode: "always" | "when_main_hidden"
      petAlwaysOnTop: boolean
    }>(IpcChannels.getPetSettings),
  setPetSettings: (partial: {
    petEnabled?: boolean
    petVisibilityMode?: "always" | "when_main_hidden"
    petAlwaysOnTop?: boolean
  }) => invoke(IpcChannels.setPetSettings, partial),
  getOnboardingCompleted: () =>
    invoke<boolean>(IpcChannels.getOnboardingCompleted),
  setOnboardingCompleted: (value: boolean) =>
    invoke(IpcChannels.setOnboardingCompleted, value),
  getEndpoint: () => invoke<string>(IpcChannels.getEndpoint),
  setEndpoint: (endpoint: string) => invoke(IpcChannels.setEndpoint, endpoint),
  getModelSettings: () =>
    invoke<{ model: string; apiKey: string; apiUrl: string }>(
      IpcChannels.getModelSettings,
    ),
  setModelSettings: (data: {
    model: string
    apiKey: string
    apiUrl: string
  }) => invoke(IpcChannels.setModelSettings, data),
  resetApp: () => invoke(IpcChannels.resetApp),
}
