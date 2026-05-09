import { BrowserWindow, screen } from "electron"
import { fileURLToPath } from "node:url"
import path from "node:path"

/**
 * 登录窗口管理
 *
 * 负责：
 * - 创建登录窗口
 * - 加载应用内 /#/login 路由页面
 * - 销毁登录窗口资源
 *
 * 生命周期：
 *   splash 关闭 → createLoginWindow() → 用户登录成功 → closeLoginWindow() → createMainWindow()
 */

let loginWin: BrowserWindow | null = null

/** 内容偏短时仍可操作的最小内容区高度（勿过大，否则会挤压成「底部大片空白」） */
const LOGIN_MIN_HEIGHT = 380
const LOGIN_MAX_HEIGHT_RATIO = 0.92

/**
 * 按内容调整登录窗口高度（useContentSize 为内容区尺寸）
 */
export function resizeLoginWindow(size: { width: number; height: number }): void {
  if (!loginWin || loginWin.isDestroyed()) return
  const workH = screen.getPrimaryDisplay().workArea.height
  const maxH = Math.floor(workH * LOGIN_MAX_HEIGHT_RATIO)
  const w = Math.max(320, Math.round(size.width))
  const h = Math.min(
    maxH,
    Math.max(LOGIN_MIN_HEIGHT, Math.round(size.height)),
  )
  loginWin.setContentSize(w, h)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * 创建登录窗口
 *
 * @param options.devServerUrl - 开发环境 Vite dev server URL
 * @param options.indexHtml - 生产环境 index.html 路径
 */
export function createLoginWindow(options: {
  devServerUrl: string | undefined
  indexHtml: string
}): void {
  if (loginWin) {
    loginWin.focus()
    return
  }

  const preload = path.join(
    process.env.APP_ROOT!,
    "dist-electron/preload/index.mjs"
  )

  loginWin = new BrowserWindow({
    width: 310,
    height: 450,
    title: "数字员工",
    icon: path.join(process.env.APP_ROOT!, "build/icon.ico"),
    frame: false,
    resizable: false,
    useContentSize: true,
    center: true,
    autoHideMenuBar: true,
    // skipTaskbar: true,
    webPreferences: {
      preload,
      zoomFactor: 0.95,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // 加载登录页路由（复用同一个 app，不同 hash 路由）
  const loginUrl = options.devServerUrl
    ? `${options.devServerUrl}#/login`
    : `file://${options.indexHtml}#/login`
  // loginWin.webContents.openDevTools()

  loginWin.loadURL(loginUrl)

  loginWin.on("closed", () => {
    loginWin = null
  })
}

/**
 * 关闭登录窗口
 *
 * 在登录成功、用户取消或需要跳转到主窗口时调用。
 */
export function closeLoginWindow(): void {
  if (!loginWin || loginWin.isDestroyed()) return
  loginWin.close()
  loginWin = null
}

/**
 * 获取登录窗口引用（供其他模块向登录窗口发送消息）
 */
export function getLoginWin(): BrowserWindow | null {
  if (loginWin && !loginWin.isDestroyed()) return loginWin
  return null
}
