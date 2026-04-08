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
  loginSuccess: () => ipcRenderer.invoke("login-success"),
  saveAuth: (
    token: string,
    user: Record<string, unknown>,
    rememberMe: boolean
  ) =>
    ipcRenderer.invoke("save-auth", { token, user, rememberMe }),
  clearAuth: () => ipcRenderer.invoke("clear-auth"),
  getAuthStatus: () =>
    ipcRenderer.invoke("get-auth-status"),
  hasSavedAuth: () => ipcRenderer.invoke("has-saved-auth"),
  openRecruitment: () => ipcRenderer.invoke("open-recruitment"),
  closeRecruitment: () => ipcRenderer.invoke("close-recruitment"),
})
