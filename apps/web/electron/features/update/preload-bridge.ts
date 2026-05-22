import { ipcRenderer } from "electron"
import { IpcChannels } from "../../shared/ipc-channels"
import { invoke, onChannelAll } from "../../preload/invoke"

export const updateBridge = {
  checkUpdate: () => invoke(IpcChannels.checkUpdate),
  startDownloadUpdate: () => invoke(IpcChannels.startDownload),
  quitAndInstall: () => invoke(IpcChannels.quitAndInstall),
  onUpdateAvailable: (
    callback: (info: {
      update: boolean
      version: string
      newVersion: string
    }) => void,
  ) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      info: { update: boolean; version: string; newVersion: string },
    ) => {
      if (info.update) callback(info)
    }
    ipcRenderer.on("update-can-available", handler)
    return () => ipcRenderer.removeListener("update-can-available", handler)
  },
  onUpdateNotAvailable: (callback: () => void) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      info: { update: boolean },
    ) => {
      if (!info.update) callback()
    }
    ipcRenderer.on("update-can-available", handler)
    return () => ipcRenderer.removeListener("update-can-available", handler)
  },
  onDownloadProgress: (
    callback: (info: {
      percent: number
      bytesPerSecond: number
      transferred: number
      total: number
    }) => void,
  ) => onChannelAll("download-progress", (info) => callback(info as never)),
  onUpdateDownloaded: (callback: () => void) =>
    onChannelAll("update-downloaded", () => callback()),
  onUpdateError: (callback: (info: { message: string }) => void) =>
    onChannelAll("update-error", (info) =>
      callback(info as { message: string }),
    ),
}
