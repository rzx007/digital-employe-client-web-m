import { app, BrowserWindow, Menu, Tray, nativeImage } from "electron"
import { setForceQuit } from "../../core/services/lifecycle"
import { resolveBrandIconPaths } from "../branding/brand-icon"
import { stopBackend } from "../backend/backend-process"
import { createSettingsWindow } from "../settings/window-settings"
import { destroyPetWindow } from "../pet/pet-window"
import { hidePetIfWhenMainHiddenMode } from "../pet/pet-main-sync"

let tray: Tray | null = null
let normalIcon: Electron.NativeImage | null = null
let notifyIcon: Electron.NativeImage | null = null
let flashTimer: ReturnType<typeof setInterval> | null = null

function generateNotifyIcon(base: Electron.NativeImage): Electron.NativeImage {
  const size = { width: 16, height: 16 }
  const resized = base.resize(size)

  const dotSize = 4
  const dotBuffer = Buffer.from([
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    255, 66, 66, 255,
  ])
  const dot = nativeImage.createFromBuffer(dotBuffer, {
    width: dotSize,
    height: dotSize,
  })

  const borderSize = 2
  const canvasSize = size.width + borderSize * 2
  const canvasBuffer = Buffer.alloc(canvasSize * canvasSize * 4)

  for (let i = 0; i < canvasSize * canvasSize; i++) {
    canvasBuffer[i * 4] = 255
    canvasBuffer[i * 4 + 1] = 66
    canvasBuffer[i * 4 + 2] = 66
    canvasBuffer[i * 4 + 3] = 255
  }

  const sourceBitmap = resized.toBitmap()
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const srcIdx = (y * size.width + x) * 4
      const r = sourceBitmap[srcIdx + 2]
      const g = sourceBitmap[srcIdx + 1]
      const b = sourceBitmap[srcIdx]
      const a = sourceBitmap[srcIdx + 3]

      const dstX = x + borderSize
      const dstY = y + borderSize
      const dstIdx = (dstY * canvasSize + dstX) * 4
      canvasBuffer[dstIdx] = r
      canvasBuffer[dstIdx + 1] = g
      canvasBuffer[dstIdx + 2] = b
      canvasBuffer[dstIdx + 3] = a
    }
  }

  return nativeImage.createFromBuffer(canvasBuffer, {
    width: canvasSize,
    height: canvasSize,
  })
}

const MAC_TRAY_ICON_SIZE = 22

function loadRawIcon(): Electron.NativeImage {
  const appRoot = process.env.APP_ROOT ?? ""
  const { ico, png } = resolveBrandIconPaths(appRoot)

  if (process.platform === "darwin") {
    const pngImg = nativeImage.createFromPath(png)
    if (!pngImg.isEmpty()) return pngImg
    return nativeImage.createFromPath(ico)
  }

  try {
    const image = nativeImage.createFromPath(ico)
    if (!image.isEmpty()) return image
  } catch {
    // .ico 加载失败，尝试 .png
  }

  return nativeImage.createFromPath(png)
}

function prepareMacTrayIcon(image: Electron.NativeImage): Electron.NativeImage {
  if (image.isEmpty()) return image

  const { width, height } = image.getSize()
  const maxDim = Math.max(width, height)
  const trayImage =
    maxDim > MAC_TRAY_ICON_SIZE
      ? image.resize({
          width: MAC_TRAY_ICON_SIZE,
          height: MAC_TRAY_ICON_SIZE,
        })
      : image

  trayImage.setTemplateImage(true)
  return trayImage
}

function loadTrayIcons(): {
  normal: Electron.NativeImage
  notify: Electron.NativeImage
} {
  const raw = loadRawIcon()

  if (process.platform === "darwin") {
    const normal = prepareMacTrayIcon(raw)
    return { normal, notify: nativeImage.createEmpty() }
  }

  return { normal: raw, notify: generateNotifyIcon(raw) }
}

export function createTray(win: BrowserWindow): void {
  if (tray) return

  const icons = loadTrayIcons()
  normalIcon = icons.normal
  notifyIcon = icons.notify

  tray = new Tray(normalIcon)
  tray.setToolTip("DigitalEmployee")

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "显示窗口",
      click: () => showMainWindow(win),
    },
    { type: "separator" },
    {
      label: "打开设置",
      click: () => createSettingsWindow(),
    },
    {
      label: "重启应用",
      click: () => restartApp(),
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => quitFromTray(win),
    },
  ])

  tray.setContextMenu(contextMenu)

  tray.on("double-click", () => {
    showMainWindow(win)
  })

  win.on("focus", () => {
    stopFlashTray()
  })
}

export function showMainWindow(win: BrowserWindow): void {
  hidePetIfWhenMainHiddenMode()
  if (win.isMinimized()) {
    win.restore()
  }
  win.show()
  win.focus()
}

export function flashTray(): void {
  if (!tray || flashTimer) return

  let showNotify = true
  flashTimer = setInterval(() => {
    if (!tray || tray.isDestroyed()) {
      stopFlashTray()
      return
    }
    tray.setImage(showNotify ? notifyIcon! : normalIcon!)
    showNotify = !showNotify
  }, 500)
}

export function stopFlashTray(): void {
  if (flashTimer) {
    clearInterval(flashTimer)
    flashTimer = null
  }
  if (tray && !tray.isDestroyed() && normalIcon) {
    tray.setImage(normalIcon)
  }
}

function restartApp(): void {
  setForceQuit(true)
  shutdownAuxiliaryWindows()
  stopBackend()
  app.relaunch({ args: process.argv.slice(1).concat(["--relaunched"]) })
  app.exit(0)
}

function quitFromTray(win: BrowserWindow): void {
  setForceQuit(true)
  shutdownAuxiliaryWindows()
  stopBackend()
  win.close()

  setTimeout(() => {
    app.exit(0)
  }, 3000).unref()
}

export function destroyTray(): void {
  stopFlashTray()
  if (tray) {
    tray.destroy()
    tray = null
  }
  normalIcon = null
  notifyIcon = null
}

export function shutdownAuxiliaryWindows(): void {
  destroyTray()
  destroyPetWindow()
}
