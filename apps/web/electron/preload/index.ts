import { ipcRenderer, contextBridge } from "electron"

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
})

contextBridge.exposeInMainWorld("electronApi", {
  // 判断是否为 Electron 环境
  isElectron: true,
  getBackendStatus: () => ipcRenderer.invoke("get-backend-status"),
  getBackendPort: () => ipcRenderer.invoke("get-backend-port"),
  onBackendError: (callback: (message: string) => void) => {
    ipcRenderer.on("backend-error", (_, message) => callback(message))
    return () => ipcRenderer.removeAllListeners("backend-error")
  },
  onBackendPort: (callback: (port: number) => void) => {
    ipcRenderer.on("backend-port", (_, port) => callback(port))
    return () => ipcRenderer.removeAllListeners("backend-port")
  },
  quitApp: () => ipcRenderer.invoke("quit-app"),
  minimizeWindow: () => ipcRenderer.invoke("minimize-window"),
  closeWindow: () => ipcRenderer.invoke("close-window"),
  maximizeWindow: () => ipcRenderer.invoke("maximize-window"),
  isMaximized: () => ipcRenderer.invoke("is-maximized"),
  setForceQuit: (value: boolean) => ipcRenderer.invoke("set-force-quit", value),
  getPlatform: () => ipcRenderer.invoke("get-platform"),
  flashTray: () => ipcRenderer.invoke("flash-tray"),
  stopFlashTray: () => ipcRenderer.invoke("stop-flash-tray"),
  sendNotification: (title: string, body: string, silent?: boolean) =>
    ipcRenderer.invoke("send-notification", { title, body, silent }),

  // auth
  loginSuccess: () => ipcRenderer.invoke("login-success"),
  saveAuth: (
    token: string,
    user: Record<string, unknown>,
    rememberMe: boolean
  ) => ipcRenderer.invoke("save-auth", { token, user, rememberMe }),
  clearAuth: () => ipcRenderer.invoke("clear-auth"),
  getAuthStatus: () => ipcRenderer.invoke("get-auth-status"),
  hasSavedAuth: () => ipcRenderer.invoke("has-saved-auth"),
  openRecruitment: () => ipcRenderer.invoke("open-recruitment"),
  closeRecruitment: () => ipcRenderer.invoke("close-recruitment"),
  notifyHireSuccess: () => ipcRenderer.invoke("hire-success"),
  onInvalidateContacts: (callback: () => void) => {
    ipcRenderer.on("invalidate-contacts", () => callback())
    return () => ipcRenderer.removeAllListeners("invalidate-contacts")
  },
  onInvalidateModelConfig: (callback: () => void) => {
    ipcRenderer.on("invalidate-model-config", () => callback())
    return () => ipcRenderer.removeAllListeners("invalidate-model-config")
  },
  // settings
  openSettings: () => ipcRenderer.invoke("open-settings"),
  closeSettings: () => ipcRenderer.invoke("close-settings"),
  setAutoLaunch: (enabled: boolean) =>
    ipcRenderer.invoke("set-auto-launch", enabled),
  getAutoLaunch: () => ipcRenderer.invoke("get-auto-launch"),
  setNotifications: (enabled: boolean) =>
    ipcRenderer.invoke("set-notifications", enabled),
  getNotifications: () => ipcRenderer.invoke("get-notifications"),
  setAutoUpdate: (enabled: boolean) =>
    ipcRenderer.invoke("set-auto-update", enabled),
  getAutoUpdate: () => ipcRenderer.invoke("get-auto-update"),
  getOnboardingCompleted: () => ipcRenderer.invoke("get-onboarding-completed"),
  setOnboardingCompleted: (value: boolean) =>
    ipcRenderer.invoke("set-onboarding-completed", value),
  getEndpoint: () => ipcRenderer.invoke("get-endpoint"),
  setEndpoint: (endpoint: string) =>
    ipcRenderer.invoke("set-endpoint", endpoint),
  getModelSettings: () => ipcRenderer.invoke("get-model-settings"),
  setModelSettings: (data: { model: string; apiKey: string; apiUrl: string }) =>
    ipcRenderer.invoke("set-model-settings", data),
  resetApp: () => ipcRenderer.invoke("reset-app"),
  checkUpdate: () => ipcRenderer.invoke("check-update"),
  startDownloadUpdate: () => ipcRenderer.invoke("start-download"),
  quitAndInstall: () => ipcRenderer.invoke("quit-and-install"),

  onUpdateAvailable: (
    callback: (info: { update: boolean; version: string; newVersion: string }) => void
  ) => {
    ipcRenderer.on("update-can-available", (_, info) => {
      if (info.update) callback(info)
    })
    return () => ipcRenderer.removeAllListeners("update-can-available")
  },
  onUpdateNotAvailable: (callback: () => void) => {
    ipcRenderer.on("update-can-available", (_, info) => {
      if (!info.update) callback()
    })
    return () => ipcRenderer.removeAllListeners("update-can-available")
  },
  onDownloadProgress: (
    callback: (info: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void
  ) => {
    ipcRenderer.on("download-progress", (_, info) => callback(info))
    return () => ipcRenderer.removeAllListeners("download-progress")
  },
  onUpdateDownloaded: (callback: () => void) => {
    ipcRenderer.on("update-downloaded", () => callback())
    return () => ipcRenderer.removeAllListeners("update-downloaded")
  },
  onUpdateError: (callback: (info: { message: string }) => void) => {
    ipcRenderer.on("update-error", (_, info) => callback(info))
    return () => ipcRenderer.removeAllListeners("update-error")
  },
})
