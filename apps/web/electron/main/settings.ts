import { BrowserWindow } from "electron"
import path from "node:path"

import { pinBrowserWindowTitle } from "./pin-window-title"

/**
 * 设置窗口管理
 *
 * 负责：
 * - 创建设置窗口（比主窗口小，不可调整大小）
 * - 加载应用内 /#/settings 路由页面
 * - 销毁设置窗口资源
 *
 * 窗口配置：800x600、有标题栏、不可调整大小
 */

let settingsWin: BrowserWindow | null = null

/**
 * 创建设置窗口
 */
export function createSettingsWindow(): void {
  if (settingsWin) {
    settingsWin.focus()
    return
  }

  const preload = path.join(
    process.env.APP_ROOT!,
    "dist-electron/preload/index.mjs"
  )

  settingsWin = new BrowserWindow({
    width: 800,
    height: 600,
    resizable: false,
    title: "数字员工 - 设置",
    icon: path.join(process.env.APP_ROOT!, "build/icon.ico"),
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
  const RENDERER_DIST = path.join(process.env.APP_ROOT!, "dist")
  const indexHtml = path.join(RENDERER_DIST, "index.html")

  const settingsUrl = VITE_DEV_SERVER_URL
    ? `${VITE_DEV_SERVER_URL}#/settings`
    : `file://${indexHtml}#/settings`

  pinBrowserWindowTitle(settingsWin, "数字员工 - 设置")
  settingsWin.loadURL(settingsUrl)

  settingsWin.on("closed", () => {
    settingsWin = null
  })
}

/**
 * 关闭设置窗口
 */
export function closeSettingsWindow(): void {
  if (!settingsWin || settingsWin.isDestroyed()) return
  settingsWin.close()
  settingsWin = null
}
