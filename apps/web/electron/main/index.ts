import { app, BrowserWindow, shell } from "electron"
import { fileURLToPath } from "node:url"
import path from "node:path"
import os from "node:os"
import { startBackend, stopBackend, getBackendPort } from "./backend"
import { registerIpcHandlers, isForceQuit, setForceQuit } from "./ipc-handlers"
import { update } from "./update"

/**
 * Electron 主进程入口
 *
 * 职责：
 * - 应用初始化（单实例锁、GPU 加速、系统通知）
 * - 创建和管理主窗口
 * - 协调后端进程的启动/停止时机
 * - 注册应用生命周期事件
 *
 * 其他职责已拆分：
 * - backend.ts: Python 后端进程管理
 * - ipc-handlers.ts: IPC 通信处理器
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

/**
 * 创建主窗口
 */
async function createWindow() {
  win = new BrowserWindow({
    title: "DigitalEmployee",
    icon: path.join(process.env.VITE_PUBLIC, "logo.svg"),
    webPreferences: {
      preload,
    },
    minWidth: 1024,
    minHeight: 768,
  })

  // 加载页面：开发环境加载 Vite dev server，生产环境加载本地文件
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(indexHtml)
  }

  win.webContents.openDevTools()

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

  // 注册 IPC 通信
  registerIpcHandlers(win)

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
 * 1. 启动 Python 后端（等待就绪或超时）
 * 2. 创建主窗口
 * 3. 如果后端启动失败，仍然创建窗口，通过 IPC 通知渲染进程
 */
app.whenReady().then(async () => {
  try {
    await startBackend()
    console.log("[App] backend server ready, creating window...")
    await createWindow()
  } catch (err) {
    console.error("[App] backend failed:", err)
    await createWindow()

    // 通知渲染进程后端启动失败
    setTimeout(() => {
      win?.webContents.send(
        "backend-error",
        err instanceof Error ? err.message : String(err)
      )
    }, 1000)
  }
})

app.on("window-all-closed", () => {
  win = null
  if (process.platform !== "darwin") app.quit()
})

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore()
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
