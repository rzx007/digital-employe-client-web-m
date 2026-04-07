import { BrowserWindow } from "electron"
import path from "node:path"

let splashWin: BrowserWindow | null = null

function createSplashWindow(options: {
  devServerUrl: string | undefined
  indexHtml: string
}) {
  splashWin = new BrowserWindow({
    width: 400,
    height: 250,
    title: "DigitalEmployee",
    icon: path.join(process.env.APP_ROOT!, "build/icon.ico"),
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  const splashUrl = options.devServerUrl
    ? `${options.devServerUrl}#/splash`
    : `file://${options.indexHtml}#/splash`

  splashWin.loadURL(splashUrl)

  splashWin.on("closed", () => {
    splashWin = null
  })
}

function closeSplashWindow() {
  if (!splashWin || splashWin.isDestroyed()) return
  splashWin.close()
  splashWin = null
}

export { createSplashWindow, closeSplashWindow }
