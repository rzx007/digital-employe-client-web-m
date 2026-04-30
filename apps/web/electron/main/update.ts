import { app, ipcMain } from 'electron'
import { createRequire } from 'node:module'
import type {
  ProgressInfo,
  UpdateDownloadedEvent,
  UpdateInfo,
} from 'electron-updater'
import { getSetting } from './settings-store'

const { autoUpdater } = createRequire(import.meta.url)('electron-updater');

let downloadListenersCleanup: (() => void) | null = null

export function update(win: Electron.BrowserWindow) {

  autoUpdater.autoDownload = false
  autoUpdater.disableWebInstaller = false
  autoUpdater.allowDowngrade = false

  autoUpdater.on('checking-for-update', function () { })

  autoUpdater.on('update-available', (arg: UpdateInfo) => {
    win.webContents.send('update-can-available', { update: true, version: app.getVersion(), newVersion: arg?.version })

    const autoUpdate = getSetting('autoUpdate')
    if (autoUpdate) {
      triggerDownload(win)
    }
  })

  autoUpdater.on('update-not-available', (arg: UpdateInfo) => {
    win.webContents.send('update-can-available', { update: false, version: app.getVersion(), newVersion: arg?.version })
  })

  ipcMain.handle('check-update', async () => {
    if (!app.isPackaged) {
      const error = new Error('The update feature is only available after the package.')
      return { message: error.message, error }
    }

    try {
      return await autoUpdater.checkForUpdatesAndNotify()
    } catch (error) {
      return { message: 'Network error', error }
    }
  })

  ipcMain.handle('start-download', (event: Electron.IpcMainInvokeEvent) => {
    triggerDownload(win)
  })

  ipcMain.handle('quit-and-install', () => {
    autoUpdater.quitAndInstall(false, true)
  })
}

function triggerDownload(win: Electron.BrowserWindow) {
  cleanupDownloadListeners()

  const onProgress = (info: ProgressInfo) => {
    win.webContents.send('download-progress', info)
  }
  const onError = (error: Error) => {
    cleanupDownloadListeners()
    win.webContents.send('update-error', { message: error.message, error })
  }
  const onDownloaded = () => {
    cleanupDownloadListeners()
    win.webContents.send('update-downloaded')
  }

  autoUpdater.on('download-progress', onProgress)
  autoUpdater.on('error', onError)
  autoUpdater.on('update-downloaded', onDownloaded)

  downloadListenersCleanup = () => {
    autoUpdater.removeListener('download-progress', onProgress)
    autoUpdater.removeListener('error', onError)
    autoUpdater.removeListener('update-downloaded', onDownloaded)
    downloadListenersCleanup = null
  }

  autoUpdater.downloadUpdate()
}

function cleanupDownloadListeners() {
  if (downloadListenersCleanup) {
    downloadListenersCleanup()
  }
}
