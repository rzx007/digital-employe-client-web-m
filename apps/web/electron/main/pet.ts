import { BrowserWindow, ipcMain, screen } from "electron"
import path from "node:path"

let petWin: BrowserWindow | null = null

let _preload: string
let _devServerUrl: string | undefined
let _indexHtml: string

const PET_WINDOW_WIDTH = 230
const PET_WINDOW_HEIGHT = 260
const PET_WINDOW_MARGIN = 24

export function createPetWindow(options: {
  devServerUrl?: string
  indexHtml: string
  preload: string
}): void {
  if (petWin && !petWin.isDestroyed()) {
    petWin.focus()
    return
  }

  _preload = options.preload
  _devServerUrl = options.devServerUrl
  _indexHtml = options.indexHtml

  petWin = new BrowserWindow({
    width: PET_WINDOW_WIDTH,
    height: PET_WINDOW_HEIGHT,
    title: "DigitalEmployee-Pet",
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    icon: path.join(process.env.APP_ROOT!, "build/icon.ico"),
    webPreferences: {
      preload: options.preload,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  const petUrl = options.devServerUrl
    ? `${options.devServerUrl}#/pet`
    : `file://${options.indexHtml}#/pet`

  petWin.loadURL(petUrl)

  // 默认隐藏，主窗口关闭时才显示
  petWin.hide()

  petWin.on("closed", () => {
    petWin = null
  })

  registerPetIpcHandlers()
}

export function showPetWindow(): void {
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
  const x = width - PET_WINDOW_WIDTH - PET_WINDOW_MARGIN
  const y = height - PET_WINDOW_HEIGHT - PET_WINDOW_MARGIN
  petWin.setPosition(x, y)
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
      petWin.setPosition(Math.round(x), Math.round(y))
    },
  )

  ipcMain.handle("pet:get-position", () => {
    if (!petWin || petWin.isDestroyed()) return null
    const [x, y] = petWin.getPosition()
    return { x, y }
  })
}
