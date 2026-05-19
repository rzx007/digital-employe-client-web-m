import type { ElectronAPI } from "@electron-toolkit/preload"
import type { ElectronApi } from "./preload/electron-api"

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
    electron?: ElectronAPI
    electronApi?: ElectronApi
  }
  const __APP_VERSION__: string
  const __BUILD_TIME__: string
  const __ENV__: string
  const __APP_PORT__: string
}

export type { BackendStatus, PlatformInfo, ElectronApi }
