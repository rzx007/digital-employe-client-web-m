import { BrowserWindow } from "electron"
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
    width: 290,
    height: 410,
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
