import type { ElectronApi } from "./preload/electron-api"

declare global {
  interface Window {
    electron?: import("@electron-toolkit/preload").ElectronAPI
    electronApi?: ElectronApi
  }
  const __APP_VERSION__: string
  const __BUILD_TIME__: string
  const __ENV__: string
  const __APP_PORT__: string
}

export type { ElectronApi }
