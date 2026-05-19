import { contextBridge } from "electron"
import { exposeElectronAPI } from "@electron-toolkit/preload"
import { electronApi } from "./electron-api"

if (process.contextIsolated) {
  try {
    exposeElectronAPI()
    contextBridge.exposeInMainWorld("electronApi", electronApi)
  } catch (error) {
    console.error("[preload] expose failed:", error)
  }
} else {
  window.electron = require("@electron-toolkit/preload").electronAPI
  window.electronApi = electronApi
}
