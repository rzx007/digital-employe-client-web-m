import { contextBridge } from "electron"
import { exposeElectronAPI } from "@electron-toolkit/preload"
import "electron-log/preload"
import { electronApi } from "./electron-api"

if (process.contextIsolated) {
  try {
    exposeElectronAPI()
    contextBridge.exposeInMainWorld("electronApi", electronApi)
  } catch (error) {
    console.error("[preload] expose failed", error)
  }
} else {
  import("@electron-toolkit/preload").then(({ electronAPI }) => {
    window.electron = electronAPI
    window.electronApi = electronApi
  })
}
