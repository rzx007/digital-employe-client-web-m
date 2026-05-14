import {
  BrowserWindow,
  ipcMain,
  screen,
  session,
  type Session,
} from "electron"
import path from "node:path"
import { getSetting } from "./settings-store"

/**
 * 独立分区，避免改写 defaultSession 的全局权限回调影响主窗口。
 * 须在 app ready 之后创建（见 getPetSession），不可在模块顶层调用 session.fromPartition。
 */
let petSession: Session | null = null

function getPetSession(): Session {
  if (!petSession) {
    petSession = session.fromPartition("persist:pet-panel", {
      cache: false,
    })
  }
  return petSession
}

let petSessionPermissionHooked = false
function ensurePetSessionMediaPermission() {
  if (petSessionPermissionHooked) return
  petSessionPermissionHooked = true
  getPetSession().setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === "media") {
      callback(true)
      return
    }
    callback(false)
  })
}

let petWin: BrowserWindow | null = null

let _preload: string
let _devServerUrl: string | undefined
let _indexHtml: string

const PET_WINDOW_WIDTH = 230
const PET_WINDOW_HEIGHT = 260
const PET_WINDOW_MARGIN = 24

export function applyPetAlwaysOnTopFromStore(): void {
  if (!petWin || petWin.isDestroyed()) return
  petWin.setAlwaysOnTop(getSetting("petAlwaysOnTop"))
}

export function createPetWindow(options: {
  devServerUrl?: string
  indexHtml: string
  preload: string
}): void {
  if (petWin && !petWin.isDestroyed()) {
    applyPetAlwaysOnTopFromStore()
    petWin.focus()
    return
  }

  _preload = options.preload
  _devServerUrl = options.devServerUrl
  _indexHtml = options.indexHtml

  ensurePetSessionMediaPermission()

  petWin = new BrowserWindow({
    width: PET_WINDOW_WIDTH,
    height: PET_WINDOW_HEIGHT,
    title: "DigitalEmployee-Pet",
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: getSetting("petAlwaysOnTop"),
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    icon: path.join(process.env.APP_ROOT!, "build/icon.ico"),
    webPreferences: {
      preload: options.preload,
      nodeIntegration: false,
      contextIsolation: true,
      session: getPetSession(),
    },
  })

  const petUrl = options.devServerUrl
    ? `${options.devServerUrl}#/pet`
    : `file://${options.indexHtml}#/pet`

  petWin.loadURL(petUrl)

  // 默认隐藏，主窗口关闭时才显示
  petWin.hide()

  applyPetAlwaysOnTopFromStore()

  petWin.on("closed", () => {
    petWin = null
  })

  registerPetIpcHandlers()
}

export function showPetWindow(): void {
  if (!getSetting("petEnabled")) return

  if (!petWin || petWin.isDestroyed()) {
    // 如果窗口被销毁了，重新创建（不 return，继续执行下面的 show 逻辑）
    createPetWindow({
      devServerUrl: _devServerUrl,
      indexHtml: _indexHtml,
      preload: _preload,
    })
  }

  if (!petWin || petWin.isDestroyed()) return

  // 定位到屏幕右下角
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.workAreaSize
  const x = Math.round(width - PET_WINDOW_WIDTH - PET_WINDOW_MARGIN)
  const y = Math.round(height - PET_WINDOW_HEIGHT - PET_WINDOW_MARGIN)
  petWin.setBounds(
    {
      x,
      y,
      width: PET_WINDOW_WIDTH,
      height: PET_WINDOW_HEIGHT,
    },
    false,
  )
  applyPetAlwaysOnTopFromStore()
  petWin.show()
  petWin.focus()
}

export function hidePetWindow(): void {
  if (!petWin || petWin.isDestroyed()) return
  petWin.hide()
}

export function destroyPetWindow(): void {
  if (!petWin || petWin.isDestroyed()) {
    petWin = null
    return
  }
  petWin.destroy()
  petWin = null
}

export function getPetWin(): BrowserWindow | null {
  return petWin
}

let _ipcRegistered = false

function registerPetIpcHandlers(): void {
  if (_ipcRegistered) return
  _ipcRegistered = true

  // pet:show 在 ipc-handlers.ts 中注册（需要 mainWin 引用）

  ipcMain.handle("pet:hide", () => {
    hidePetWindow()
  })

  ipcMain.handle(
    "pet:set-position",
    (_event, x: number, y: number) => {
      if (!petWin || petWin.isDestroyed()) return
      petWin.setBounds(
        {
          x: Math.round(x),
          y: Math.round(y),
          width: PET_WINDOW_WIDTH,
          height: PET_WINDOW_HEIGHT,
        },
        false,
      )
    },
  )

  ipcMain.handle("pet:get-position", () => {
    if (!petWin || petWin.isDestroyed()) return null
    const [x, y] = petWin.getPosition()
    return { x, y }
  })
}
