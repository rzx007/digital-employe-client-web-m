import { app } from "electron"
import {
  createSettingsWindow,
  closeSettingsWindow,
} from "./window-settings"
import { setAutoLaunch, getAutoLaunch } from "./auto-launch"
import { setNotificationsEnabled } from "../notification-tray/notification"
import { syncPetVisibilityWithMain } from "../pet/pet-main-sync"
import {
  getSetting,
  setSetting,
  getModelSettings,
  setModelSettings,
  getEndpoint,
  setEndpoint,
  clearSettingsStore,
  type PetVisibilityMode,
} from "./settings-store"
import { clearAuth } from "../auth/auth-store"
import { IpcChannels } from "../../shared/ipc-channels"
import type { AppContext } from "../../core/app-context"
import type { IpcContribution } from "../../core/ipc/types"

export const settingsIpcContribution: IpcContribution = {
  id: "settings",
  register(ctx: AppContext) {
    const getMain = () => ctx.windowManager.getMain()

    return [
      {
        channel: IpcChannels.openSettings,
        handler: () => createSettingsWindow(),
      },
      {
        channel: IpcChannels.closeSettings,
        handler: () => closeSettingsWindow(),
      },
      {
        channel: IpcChannels.setAutoLaunch,
        handler: (_event, enabled: unknown) => {
          setAutoLaunch(Boolean(enabled))
        },
      },
      {
        channel: IpcChannels.getAutoLaunch,
        handler: () => getAutoLaunch(),
      },
      {
        channel: IpcChannels.setNotifications,
        handler: (_event, enabled: unknown) => {
          setSetting("notifications", Boolean(enabled))
          setNotificationsEnabled(Boolean(enabled))
        },
      },
      {
        channel: IpcChannels.getNotifications,
        handler: () => getSetting("notifications") ?? true,
      },
      {
        channel: IpcChannels.setAutoUpdate,
        handler: (_event, enabled: unknown) => {
          setSetting("autoUpdate", Boolean(enabled))
        },
      },
      {
        channel: IpcChannels.getAutoUpdate,
        handler: () => getSetting("autoUpdate") ?? true,
      },
      {
        channel: IpcChannels.getPetSettings,
        handler: () => ({
          petEnabled: getSetting("petEnabled"),
          petVisibilityMode: getSetting("petVisibilityMode"),
          petAlwaysOnTop: getSetting("petAlwaysOnTop"),
        }),
      },
      {
        channel: IpcChannels.setPetSettings,
        handler: (_event, partial: unknown) => {
          const p = partial as Partial<{
            petEnabled: boolean
            petVisibilityMode: PetVisibilityMode
            petAlwaysOnTop: boolean
          }>
          if (typeof p.petEnabled === "boolean") {
            setSetting("petEnabled", p.petEnabled)
          }
          if (
            p.petVisibilityMode === "always" ||
            p.petVisibilityMode === "when_main_hidden"
          ) {
            setSetting("petVisibilityMode", p.petVisibilityMode)
          }
          if (typeof p.petAlwaysOnTop === "boolean") {
            setSetting("petAlwaysOnTop", p.petAlwaysOnTop)
          }
          syncPetVisibilityWithMain(getMain())
        },
      },
      {
        channel: IpcChannels.getOnboardingCompleted,
        handler: () => getSetting("onboardingCompleted") ?? false,
      },
      {
        channel: IpcChannels.setOnboardingCompleted,
        handler: (_event, value: unknown) => {
          setSetting("onboardingCompleted", Boolean(value))
        },
      },
      {
        channel: IpcChannels.getModelSettings,
        handler: () => getModelSettings(),
      },
      {
        channel: IpcChannels.setModelSettings,
        handler: (
          _event,
          data: { model: string; apiKey: string; apiUrl: string },
        ) => {
          setModelSettings(data)
          const main = getMain()
          if (main && !main.isDestroyed()) {
            main.webContents.send("invalidate-model-config")
          }
        },
      },
      {
        channel: IpcChannels.getEndpoint,
        handler: () => getEndpoint(),
      },
      {
        channel: IpcChannels.setEndpoint,
        handler: (_event, endpoint: unknown) => {
          setEndpoint(String(endpoint))
        },
      },
      {
        channel: IpcChannels.resetApp,
        handler: () => {
          clearAuth()
          clearSettingsStore()
          app.relaunch({
            args: process.argv.slice(1).concat(["--relaunched"]),
          })
          app.exit(0)
        },
      },
    ]
  },
}
