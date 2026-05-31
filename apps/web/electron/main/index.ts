import { app, BrowserWindow, shell, protocol } from "electron"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { is } from "@electron-toolkit/utils"
import { getBackendPort } from "../features/backend/backend-process"
import { createTray, showMainWindow } from "../features/notification-tray/tray"
import { getSetting } from "../features/settings/settings-store"
import { createPetWindow, showPetWindow } from "../features/pet/pet-window"
import { syncPetOnMainForegroundState } from "../features/pet/pet-main-sync"
import { APP_DISPLAY_NAME } from "./app-product"
import { initMainLogger } from "../core/logger"
import { bootstrapApp } from "../core/bootstrap"

initMainLogger()
import { resolveAppRootFromMainEntry } from "../core/app-context"
import { bindElectronRuntime } from "../core/runtime-paths"
import { WindowManager } from "../core/services/window-manager"
import { bindWindowManager } from "../core/services/window-registry"
import { isForceQuit, shutdownOnBeforeQuit } from "../core/services/lifecycle"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = resolveAppRootFromMainEntry(__dirname)

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const paths = bindElectronRuntime(__dirname, VITE_DEV_SERVER_URL)
const windowManager = new WindowManager()
bindWindowManager(windowManager)

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT!, "public")
  : paths.rendererDist

app.commandLine.appendSwitch("lang", "zh-CN")

if (process.platform === "win32")
  app.setAppUserModelId("com.digital-employee-m.app")

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "petdex",
    privileges: {
      bypassCSP: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
      standard: true,
    },
  },
])

if (process.platform === "darwin") {
  app.setName(APP_DISPLAY_NAME)
}

app.on("browser-window-created", (_event, browserWindow) => {
  browserWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.key !== "F12") return
    if (input.control || input.meta || input.alt) return
    event.preventDefault()
    browserWindow.webContents.toggleDevTools()
  })
})

let win: BrowserWindow | null = null

function getMainWindowOptions(): Electron.BrowserWindowConstructorOptions {
  const base: Electron.BrowserWindowConstructorOptions = {
    title: APP_DISPLAY_NAME,
    icon: path.join(process.env.APP_ROOT!, "build/icon.ico"),
    webPreferences: {
      preload: paths.preloadPath,
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

async function createWindow() {
  win = new BrowserWindow(getMainWindowOptions())

  if (is.dev) {
    win.loadURL(VITE_DEV_SERVER_URL as string)
  } else {
    win.loadFile(paths.indexHtml)
  }

  win.on("close", (e) => {
    if (!isForceQuit()) {
      e.preventDefault()
      win?.hide()
      showPetWindow()
    }
  })

  win.on("closed", () => {
    win = null
    windowManager.set("main", null)
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

  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", new Date().toLocaleString())
    win?.webContents.send("backend-port", getBackendPort())
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) shell.openExternal(url)
    return { action: "deny" }
  })

  windowManager.set("main", win)
  createTray(win)

  createPetWindow()

  if (
    getSetting("petEnabled") &&
    getSetting("petVisibilityMode") === "always"
  ) {
    showPetWindow()
  }
}

app.on("before-quit", (e) => {
  if (isForceQuit()) return
  e.preventDefault()
  shutdownOnBeforeQuit()
  setTimeout(() => {
    app.exit(0)
  }, 3000).unref()
})

app.whenReady().then(() => {
  void bootstrapApp({
    mainDirname: __dirname,
    devServerUrl: VITE_DEV_SERVER_URL,
    windowManager,
    createMainWindow: createWindow,
  })
})

app.on("window-all-closed", () => {
  win = null
})

app.on("second-instance", () => {
  if (win && !win.isDestroyed()) {
    showMainWindow(win)
  }
})

app.on("activate", () => {
  if (win && !win.isDestroyed()) {
    showMainWindow(win)
    return
  }

  const visible = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
  if (visible.length) {
    showMainWindow(visible[0])
    return
  }

  void createWindow()
})

/** @deprecated 供尚未迁移的模块使用；新代码请用 createAppPaths */
export const indexHtml = paths.indexHtml
export { VITE_DEV_SERVER_URL }
