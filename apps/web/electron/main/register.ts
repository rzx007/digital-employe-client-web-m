import { BrowserWindow, screen } from "electron"
import path from "node:path"

/**
 * 注册窗口管理
 *
 * 负责：
 * - 创建注册窗口（frameless、自适应高度）
 * - 加载应用内 /#/register 路由页面
 * - 销毁注册窗口资源
 *
 * 生命周期：
 *   登录页"去注册" → createRegisterWindow() → 注册成功 → closeRegisterWindow()
 */

let registerWin: BrowserWindow | null = null

const REGISTER_MIN_HEIGHT = 500
const REGISTER_MAX_HEIGHT_RATIO = 0.92

/**
 * 按内容调整注册窗口高度
 */
export function resizeRegisterWindow(size: {
  width: number
  height: number
}): void {
  if (!registerWin || registerWin.isDestroyed()) return
  const workH = screen.getPrimaryDisplay().workArea.height
  const maxH = Math.floor(workH * REGISTER_MAX_HEIGHT_RATIO)
  const w = Math.max(380, Math.round(size.width))
  const h = Math.min(
    maxH,
    Math.max(REGISTER_MIN_HEIGHT, Math.round(size.height)),
  )
  registerWin.setContentSize(w, h)
}

/**
 * 创建注册窗口
 */
export function createRegisterWindow(options: {
  devServerUrl: string | undefined
  indexHtml: string
}): void {
  if (registerWin) {
    registerWin.focus()
    return
  }

  const preload = path.join(
    process.env.APP_ROOT!,
    "dist-electron/preload/index.mjs",
  )

  registerWin = new BrowserWindow({
    width: 400,
    height: 640,
    title: "注册",
    icon: path.join(process.env.APP_ROOT!, "build/icon.ico"),
    frame: false,
    resizable: false,
    useContentSize: true,
    center: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload,
      zoomFactor: 0.95,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  const registerUrl = options.devServerUrl
    ? `${options.devServerUrl}#/register`
    : `file://${options.indexHtml}#/register`

  registerWin.loadURL(registerUrl)

  registerWin.on("closed", () => {
    registerWin = null
  })
}

/**
 * 关闭注册窗口
 */
export function closeRegisterWindow(): void {
  if (!registerWin || registerWin.isDestroyed()) return
  registerWin.close()
  registerWin = null
}
