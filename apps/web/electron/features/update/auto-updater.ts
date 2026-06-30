import { app, BrowserWindow } from "electron"
import { createRequire } from "node:module"
import type { ProgressInfo, UpdateInfo } from "electron-updater"
import { createLogger } from "../../core/logger"
import { getSetting } from "../settings/settings-store"
import { getBackendPort } from "../backend/backend-process"
import { isOfflineMode } from "../../core/runtime-env"

const log = createLogger("update")

const { autoUpdater } = createRequire(import.meta.url)("electron-updater")

let downloadListenersCleanup: (() => void) | null = null
let _updaterListenersRegistered = false

function getPlatformPath(): string {
  switch (process.platform) {
    case "win32":
      return "/win32"
    case "darwin":
      return "/macos"
    default:
      return "/linux"
  }
}

async function resolveUpdateFeedURL(): Promise<string | null> {
  try {
    const port = getBackendPort()
    const res = await fetch(
      `http://localhost:${port}/config-kvs/REMOTE_API_BASE_URL`,
    )
    if (!res.ok) return null
    const json = await res.json()
    const baseUrl: string | undefined = json?.data?.config_value
    if (baseUrl) {
      // BobanStaffNext 独立产品分叉：更新产物隔离在 <platform>/ 子目录，
      // 与正式版 BobanStaff（同服务器 <platform> 根）互不串更新。
      return `${baseUrl.replace(/\/+$/, "")}${getPlatformPath()}/`
    }
  } catch {
    // backend not available
  }
  return null
}

function sendToAll(channel: string, ...args: unknown[]) {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  })
}

export async function checkForUpdatesFromMenu(): Promise<unknown> {
  if (!app.isPackaged) {
    const feedUrl = await resolveUpdateFeedURL()
    const error = new Error(
      `The update feature is only available after the package. feedUrl=${feedUrl}`,
    )
    sendToAll("update-error", { message: error.message, error })
    return { message: error.message, error }
  }

  try {
    const feedUrl = await resolveUpdateFeedURL()
    if (feedUrl) {
      autoUpdater.setFeedURL({ provider: "generic", url: feedUrl })
    }
    return await autoUpdater.checkForUpdates()
  } catch (error) {
    sendToAll("update-error", { message: "Network error", error })
    return { message: "Network error", error }
  }
}

export function triggerDownloadUpdate(): void {
  triggerDownload()
}

export function quitAndInstallUpdate(): void {
  autoUpdater.quitAndInstall(false, true)
}

export function initAutoUpdater(): void {
  if (isOfflineMode()) {
    log.info("offline mode, skipping auto updater init")
    return
  }
  if (_updaterListenersRegistered) return
  _updaterListenersRegistered = true

  autoUpdater.autoDownload = false
  autoUpdater.disableWebInstaller = false
  autoUpdater.allowDowngrade = false

  autoUpdater.on("checking-for-update", function () { })

  autoUpdater.on("error", (error: Error) => {
    log.error("updater error", { message: error.message })
    sendToAll("update-error", { message: error.message, error })
  })

  autoUpdater.on("update-available", (arg: UpdateInfo) => {
    sendToAll("update-can-available", {
      update: true,
      version: app.getVersion(),
      newVersion: arg?.version,
    })

    const autoUpdate = getSetting("autoUpdate")
    if (autoUpdate) {
      triggerDownload()
    }
  })

  autoUpdater.on("update-not-available", (arg: UpdateInfo) => {
    sendToAll("update-can-available", {
      update: false,
      version: app.getVersion(),
      newVersion: arg?.version,
    })
  })
}

function triggerDownload() {
  cleanupDownloadListeners()

  const onProgress = (info: ProgressInfo) => {
    sendToAll("download-progress", info)
  }
  const onError = (error: Error) => {
    cleanupDownloadListeners()
    log.error("download error", { message: error.message })
    sendToAll("update-error", { message: error.message, error })
  }
  const onDownloaded = () => {
    cleanupDownloadListeners()
    sendToAll("update-downloaded")
  }

  autoUpdater.on("download-progress", onProgress)
  autoUpdater.on("error", onError)
  autoUpdater.on("update-downloaded", onDownloaded)

  downloadListenersCleanup = () => {
    autoUpdater.removeListener("download-progress", onProgress)
    autoUpdater.removeListener("error", onError)
    autoUpdater.removeListener("update-downloaded", onDownloaded)
    downloadListenersCleanup = null
  }

  autoUpdater.downloadUpdate()
}

function cleanupDownloadListeners() {
  if (downloadListenersCleanup) {
    downloadListenersCleanup()
  }
}
