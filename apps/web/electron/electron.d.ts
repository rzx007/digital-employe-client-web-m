interface IpcRendererAPI {
  on: (
    channel: string,
    listener: (...args: any[]) => void
  ) => Electron.IpcRenderer
  off: (channel: string, ...args: any[]) => Electron.IpcRenderer
  send: (channel: string, ...args: any[]) => any
  invoke: (channel: string, ...args: any[]) => Promise<any>
  removeListener: (
    channel: string,
    listener: (...args: any[]) => void
  ) => Electron.IpcRenderer
  resizeWindow: (size: { height: number; width: number }) => void
  getPlatform: () => {
    isLinux: boolean
    isWin: boolean
    isMac: boolean
  }
  getStoreValue: (key: string) => Promise<any>
  setStoreValue: (key: string, value: any) => Promise<void>
  getAllStore: () => Promise<any>
  clearStore: () => Promise<void>
}

interface BackendStatus {
  ready: boolean
  port: number
  running: boolean
}

interface PlatformInfo {
  isLinux: boolean
  isWin: boolean
  isMac: boolean
}

declare global {
  interface Window {
    ipcRenderer?: IpcRendererAPI
    electronApi?: {
      isElectron: boolean
      getBackendStatus: () => Promise<BackendStatus>
      getBackendPort: () => Promise<number>
      onBackendError: (callback: (message: string) => void) => () => void
      onBackendPort: (callback: (port: number) => void) => () => void
      quitApp: () => Promise<void>
      minimizeWindow: () => Promise<void>
      closeWindow: () => Promise<void>
      maximizeWindow: () => Promise<void>
      isMaximized: () => Promise<boolean>
      setForceQuit: (value: boolean) => Promise<void>
      getPlatform: () => Promise<PlatformInfo>
      flashTray: () => Promise<void>
      stopFlashTray: () => Promise<void>
      sendNotification: (
        title: string,
        body: string,
        silent?: boolean
      ) => Promise<void>
      loginSuccess: () => Promise<void>
      resizeLoginWindow: (size: {
        width: number
        height: number
      }) => Promise<void>
      saveAuth: (
        token: string,
        user: Record<string, unknown>,
        rememberMe: boolean
      ) => Promise<void>
      clearAuth: () => Promise<void>
      getAuthStatus: () => Promise<{
        token: string | null
        user: Record<string, unknown> | null
        rememberMe: boolean
      }>
      hasSavedAuth: () => Promise<boolean>
      openRecruitment: () => Promise<void>
      closeRecruitment: () => Promise<void>
      notifyHireSuccess: () => Promise<void>
      openRegister: () => Promise<void>
      closeRegister: () => Promise<void>
      notifyRegisterSuccess: (username: string) => Promise<void>
      onRegisterSuccess: (callback: (username: string) => void) => () => void
      resizeRegisterWindow: (size: {
        width: number
        height: number
      }) => Promise<void>
      onInvalidateContacts: (callback: () => void) => () => void
      onInvalidateModelConfig: (callback: () => void) => () => void
      openSettings: () => Promise<void>
      closeSettings: () => Promise<void>
      setAutoLaunch: (enabled: boolean) => Promise<void>
      getAutoLaunch: () => Promise<boolean>
      setNotifications: (enabled: boolean) => Promise<void>
      getNotifications: () => Promise<boolean>
      setAutoUpdate: (enabled: boolean) => Promise<void>
      getAutoUpdate: () => Promise<boolean>
      getPetSettings: () => Promise<{
        petEnabled: boolean
        petVisibilityMode: "always" | "when_main_hidden"
        petAlwaysOnTop: boolean
      }>
      setPetSettings: (partial: {
        petEnabled?: boolean
        petVisibilityMode?: "always" | "when_main_hidden"
        petAlwaysOnTop?: boolean
      }) => Promise<void>
      getOnboardingCompleted: () => Promise<boolean>
      setOnboardingCompleted: (value: boolean) => Promise<void>
      getEndpoint: () => Promise<string>
      setEndpoint: (endpoint: string) => Promise<void>
      getModelSettings: () => Promise<{
        model: string
        apiKey: string
        apiUrl: string
      }>
      setModelSettings: (data: {
        model: string
        apiKey: string
        apiUrl: string
      }) => Promise<void>
      resetApp: () => Promise<void>
      checkUpdate: () => Promise<any>
      startDownloadUpdate: () => Promise<void>
      quitAndInstall: () => Promise<void>
      showPet: () => Promise<void>
      hidePet: () => Promise<void>
      setPetPosition: (x: number, y: number) => Promise<void>
      getPetPosition: () => Promise<{ x: number; y: number } | null>
      onUpdateAvailable: (
        callback: (info: {
          update: boolean
          version: string
          newVersion: string
        }) => void
      ) => () => void
      onUpdateNotAvailable: (callback: () => void) => () => void
      onDownloadProgress: (
        callback: (info: {
          percent: number
          bytesPerSecond: number
          transferred: number
          total: number
        }) => void
      ) => () => void
      onUpdateDownloaded: (callback: () => void) => () => void
      onUpdateError: (
        callback: (info: { message: string }) => void
      ) => () => void
    }
  }
  const __APP_VERSION__: string
  const __BUILD_TIME__: string
  const __ENV__: string
  const __APP_PORT__: string
}
export {}
