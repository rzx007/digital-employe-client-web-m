import { app, BrowserWindow, shell, Menu, protocol, net } from "electron"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"
import os from "node:os"
import { startBackend, stopBackend, getBackendPort } from "./backend"
import {
  registerIpcHandlers,
  isForceQuit,
  setForceQuit,
  setMainWindow,
} from "./ipc-handlers"
import { update } from "./update"
import { createSplashWindow, closeSplashWindow } from "./splash"
import { createTray, shutdownAuxiliaryWindows } from "./tray"
import { createLoginWindow } from "./login"
import { initAuthStore, hasToken } from "./auth"
import { initSettingsStore, getSetting } from "./settings-store"
import { createPetWindow, showPetWindow, hidePetWindow } from "./pet"
import {
  hidePetIfWhenMainHiddenMode,
  syncPetOnMainForegroundState,
} from "./pet-main-sync"
import { APP_DISPLAY_NAME } from "./app-product"
import { createMacApplicationMenu } from "./application-menu"

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

//  语言设置
app.commandLine.appendSwitch("lang", "zh-CN")

// ========== 平台兼容性 ==========

// Windows 7 禁用 GPU 加速
if (os.release().startsWith("6.1")) app.disableHardwareAcceleration()

// Windows 10+ 设置应用用户模型 ID（用于系统通知）
if (process.platform === "win32")
  app.setAppUserModelId("com.digital-employee-m.app")

// ========== 单实例锁 ==========

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// ========== Petdex 自定义协议 ==========

protocol.registerSchemesAsPrivileged([
  {
    scheme: "petdex",
    privileges: { bypassCSP: true, stream: true, supportFetchAPI: true },
  },
])

/** macOS：在 ready 前设置，改善 Dock/部分系统文案（开发包下菜单第一项仍可能为 Electron） */
if (process.platform === "darwin") {
  app.setName(APP_DISPLAY_NAME)
}

/** F12 切换当前窗口开发者工具（主窗口、登录窗、招聘窗等） */
app.on("browser-window-created", (_event, browserWindow) => {
  browserWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.key !== "F12") return
    if (input.control || input.meta || input.alt) return
    event.preventDefault()
    browserWindow.webContents.toggleDevTools()
  })
})

// ========== 窗口管理 ==========

let win: BrowserWindow | null = null
const preload = path.join(__dirname, "../preload/index.mjs")
const indexHtml = path.join(RENDERER_DIST, "index.html")

// 导出给其他模块使用（登录、招聘等窗口）
export { VITE_DEV_SERVER_URL, indexHtml }

function getMainWindowOptions(): Electron.BrowserWindowConstructorOptions {
  const base: Electron.BrowserWindowConstructorOptions = {
    title: APP_DISPLAY_NAME,
    icon: path.join(process.env.APP_ROOT!, "build/icon.ico"),
    webPreferences: {
      preload,
    },
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
  }

  if (process.platform === "darwin") {
    return {
      ...base,
      frame: true,
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 12, y: 11 },
    }
  }

  return {
    ...base,
    frame: false,
  }
}

/**
 * 创建主窗口
 */
async function createWindow() {
  win = new BrowserWindow(getMainWindowOptions())

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
      showPetWindow()
    }
  })

  win.on("closed", () => {
    win = null
  })

  win.on("minimize", () => {
    if (!getSetting("petEnabled")) return
    showPetWindow()
  })

  win.on("restore", () => {
    if (win) syncPetOnMainForegroundState(win)
  })

  win.on("show", () => {
    if (win) syncPetOnMainForegroundState(win)
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

  // 创建宠物窗口（初始隐藏，主窗口关闭时显示）
  createPetWindow({
    devServerUrl: VITE_DEV_SERVER_URL,
    indexHtml,
    preload,
  })

  if (
    getSetting("petEnabled") &&
    getSetting("petVisibilityMode") === "always"
  ) {
    showPetWindow()
  }

  // 自动更新
  update()
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
  shutdownAuxiliaryWindows()
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
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(createMacApplicationMenu())
  } else {
    Menu.setApplicationMenu(null)
  }

  initAuthStore()
  initSettingsStore()

  protocol.handle("petdex", (request) => {
    const url = new URL(request.url)
    const requestedPath = path.normalize(url.pathname.replace(/^\//, ""))
    const fullPath = path.resolve(os.homedir(), ".codex", "pets", url.hostname, requestedPath)
    const petsRoot = path.resolve(os.homedir(), ".codex", "pets")
    const relative = path.relative(petsRoot, fullPath)
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return new Response("Forbidden", { status: 403 })
    }
    return net.fetch(pathToFileURL(fullPath).href)
  })

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
    hidePetIfWhenMainHiddenMode()
  }
})

app.on("activate", () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
    hidePetIfWhenMainHiddenMode()
  } else {
    createWindow()
  }
})
