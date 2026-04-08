import { app, BrowserWindow, shell, Menu } from "electron"
import { fileURLToPath } from "node:url"
import path from "node:path"
import os from "node:os"
import { startBackend, stopBackend, getBackendPort } from "./backend"
import { registerIpcHandlers, isForceQuit, setForceQuit, setMainWindow } from "./ipc-handlers"
import { update } from "./update"
import {
  createSplashWindow,
  closeSplashWindow,
} from "./splash"
import { createTray, destroyTray } from "./tray"
import { createLoginWindow } from "./login"
import { initAuthStore, hasToken } from "./auth"

/**
 * Electron 主进程入口
 *
 * 职责：
 * - 应用初始化（单实例锁、GPU 加速、系统通知）
 * - 创建和管理主窗口
 * - 协调后端进程的启动/停止时机
 * - 注册应用生命周期事件
 *
 * 功能：
 * - backend.ts: Python 后端进程管理
 * - ipc-handlers.ts: IPC 通信处理器
 * - splash.ts: 加载窗口管理
 * - tray.ts: 系统托盘管理
 * - login.ts: 登录窗口管理
 * - auth.ts: 认证持久化管理
 * - update.ts: 自动更新
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ========== 路径配置 ==========

process.env.APP_ROOT = path.join(__dirname, "../..")

const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron")
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist")
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST

// ========== 平台兼容性 ==========

// Windows 7 禁用 GPU 加速
if (os.release().startsWith("6.1")) app.disableHardwareAcceleration()

// Windows 10+ 设置应用用户模型 ID（用于系统通知）
if (process.platform === "win32") app.setAppUserModelId(app.getName())

// ========== 单实例锁 ==========

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// ========== 窗口管理 ==========

let win: BrowserWindow | null = null
const preload = path.join(__dirname, "../preload/index.mjs")
const indexHtml = path.join(RENDERER_DIST, "index.html")

// 导出给其他模块使用（登录、招聘等窗口）
export { VITE_DEV_SERVER_URL, indexHtml }

/**
 * 创建主窗口
 */
async function createWindow() {
  win = new BrowserWindow({
    title: "DigitalEmployee",
    icon: path.join(process.env.APP_ROOT, "build/icon.ico"),
    webPreferences: {
      preload,
    },
    minWidth: 1024,
    minHeight: 768,
  })

  // 加载页面：开发环境加载 Vite dev server，生产环境加载本地文件
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    win.loadFile(indexHtml)
  }



  // 点击关闭按钮(X) → 隐藏窗口到托盘，不退出应用
  // forceQuit 为 true 时（从托盘菜单退出），允许窗口真正关闭
  win.on("close", (e) => {
    if (!isForceQuit()) {
      e.preventDefault()
      win?.hide()
    }
  })

  // 页面加载完成后通知渲染进程
  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", new Date().toLocaleString())
    win?.webContents.send("backend-port", getBackendPort())
  })

  // https 链接在系统浏览器中打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) shell.openExternal(url)
    return { action: "deny" }
  })

  //  IPC handlers 的窗口引用（窗口控制类 IPC 生效）
  setMainWindow(win)

  // 创建系统托盘（窗口关闭后仍可从托盘操作）
  createTray(win)

  // 自动更新
  update(win)
}

// ========== 应用生命周期 ==========

/**
 * 退出前清理
 *
 * 首次触发时：标记 forceQuit，停止后端，延迟退出
 * 后续触发时（forceQuit=true）：直接退出，不再阻止
 */
app.on("before-quit", (e) => {
  if (isForceQuit()) return
  e.preventDefault()

  setForceQuit(true)
  destroyTray()
  stopBackend()

  // 兜底超时：即使后端未退出，也要确保应用能退出
  setTimeout(() => {
    app.exit(0)
  }, 3000).unref()
})

/**
 * 应用就绪
 *
 * 启动顺序：
 * 1. 初始化认证存储
 * 2. 注册 IPC 通信
 * 3. 启动 Python 后端（等待就绪或超时）
 * 4. 关闭 splash
 * 5. 检查是否有持久化 token → 有则直接进主窗口，否则进登录窗口
 */
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)

  initAuthStore()

  registerIpcHandlers(async () => {
    await createWindow()
  })

  createSplashWindow({
    devServerUrl: VITE_DEV_SERVER_URL,
    indexHtml,
  })

  try {
    await startBackend()
    console.log("[App] backend server ready")
    closeSplashWindow()

    // 检查是否有持久化的 token，有则跳过登录
    if (hasToken()) {
      console.log("[App] saved token found, skipping login...")
      await createWindow()
    } else {
      console.log("[App] no saved token, opening login window...")
      createLoginWindow({ devServerUrl: VITE_DEV_SERVER_URL, indexHtml })
    }
  } catch (err) {
    console.error("[App] backend failed:", err)
    setTimeout(() => {
      closeSplashWindow()
      createLoginWindow({ devServerUrl: VITE_DEV_SERVER_URL, indexHtml })
    }, 1500)
  }
})

app.on("window-all-closed", () => {
  win = null
  // 不退出应用，保持 tray 存活
  // 真正退出走 tray 菜单「退出」或 forceQuit
})

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    // 窗口隐藏到托盘时也要能唤出
    win.show()
    win.focus()
  }
})

app.on("activate", () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
})
