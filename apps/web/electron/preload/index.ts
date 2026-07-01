import { contextBridge, ipcRenderer } from "electron"
import { exposeElectronAPI } from "@electron-toolkit/preload"
import "electron-log/preload"
import { electronApi } from "./electron-api"

// 同步取已解析品牌（main 已注册 brand:get-sync）。失败时退回 undefined，
// renderer getBrand() 会用 web 兜底品牌。
let brand: unknown
try {
  brand = ipcRenderer.sendSync("brand:get-sync")
} catch (error) {
  console.error("[preload] brand sync failed", error)
}

if (process.contextIsolated) {
  try {
    exposeElectronAPI()
    contextBridge.exposeInMainWorld("electronApi", electronApi)
    contextBridge.exposeInMainWorld("brand", brand)
  } catch (error) {
    console.error("[preload] expose failed", error)
  }
} else {
  window.brand = brand as Window["brand"]
  import("@electron-toolkit/preload").then(({ electronAPI }) => {
    window.electron = electronAPI
    window.electronApi = electronApi
  })
}
