import { app, BrowserWindow, dialog } from "electron"
import {
  exportLogsToFile,
  openLogsDirectory,
} from "../logs/log-exporter"
import {
  revealPathInExplorer,
  type ExplorerEntryType,
} from "../shell/open-in-explorer"
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
        // 头像上传成功后，由上传窗口（通常是独立的设置窗口）调用，
        // 广播给所有窗口——各窗口是独立渲染进程/独立 store，否则只有
        // 上传窗口自己刷新，主窗口侧栏头像不会变。
        channel: IpcChannels.broadcastAvatarUpdated,
        handler: () => {
          BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed()) {
              win.webContents.send("avatar-updated")
            }
          })
        },
      },
      {
        // 设置窗改浅色/深色/主题色后广播，主窗等独立渲染进程实时 apply。
        channel: IpcChannels.broadcastThemeChanged,
        handler: () => {
          BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed()) {
              win.webContents.send("theme-changed")
            }
          })
        },
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
      {
        channel: IpcChannels.openLogsDirectory,
        handler: async () => {
          await openLogsDirectory()
        },
      },
      {
        channel: IpcChannels.revealPathInExplorer,
        handler: async (_event, targetPath: unknown, entryType: unknown) => {
          if (typeof targetPath !== "string" || !targetPath.trim()) {
            throw new Error("无效路径")
          }
          if (entryType !== "file" && entryType !== "directory") {
            throw new Error("无效条目类型")
          }
          await revealPathInExplorer(
            targetPath,
            entryType as ExplorerEntryType
          )
        },
      },
      {
        channel: IpcChannels.selectDirectory,
        handler: async (event) => {
          const parent = BrowserWindow.fromWebContents(event.sender)
          if (!parent || parent.isDestroyed()) {
            throw new Error("No host window available for file dialog")
          }
          const result = await dialog.showOpenDialog(parent, {
            title: "选择文件夹",
            properties: ["openDirectory"],
          })
          if (result.canceled || result.filePaths.length === 0) {
            return null
          }
          return result.filePaths[0]!
        },
      },
      {
        channel: IpcChannels.exportLogs,
        handler: async (event) => {
          const parent = BrowserWindow.fromWebContents(event.sender)
          if (!parent || parent.isDestroyed()) {
            throw new Error("No host window available for save dialog")
          }
          return exportLogsToFile(parent)
        },
      },
    ]
  },
}
