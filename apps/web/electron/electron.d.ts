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
      sendNotification: (title: string, body: string, silent?: boolean) => Promise<void>
    }
  }
  const __APP_VERSION__: string
  const __BUILD_TIME__: string
  const __ENV__: string
  const __APP_PORT__: string
}
export {}
