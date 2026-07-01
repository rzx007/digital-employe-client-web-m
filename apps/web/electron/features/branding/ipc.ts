import { ipcMain } from "electron"

import { getResolvedBrand } from "./brand-config"

/**
 * 注册品牌同步 IPC。必须在 app ready 后、创建任何窗口前调用：
 * preload 用 ipcRenderer.sendSync 同步取品牌，首帧即有、不闪旧名。
 */
export function registerBrandingIpc(): void {
  ipcMain.on("brand:get-sync", (event) => {
    event.returnValue = getResolvedBrand()
  })
}
