import { BrowserWindow, screen, session, type Session } from "electron"
import {
  buildHashRouteUrl,
  getAppIconPath,
  getPreloadPath,
} from "../core/runtime-paths"
import { getWindowManager } from "../core/services/window-registry"
import { getSetting } from "./settings-store"
import { handlePetdexRequest } from "../core/petdex-protocol"

let petSession: Session | null = null

function getPetSession(): Session {
  if (!petSession) {
    petSession = session.fromPartition("persist:pet-panel", {
      cache: false,
    })
    petSession.protocol.handle("petdex", handlePetdexRequest)
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

const PET_WINDOW_WIDTH = 230
const PET_WINDOW_HEIGHT = 260
const PET_WINDOW_MARGIN = 24

export function applyPetAlwaysOnTopFromStore(): void {
  const petWin = getWindowManager().get("pet")
  if (!petWin) return
  petWin.setAlwaysOnTop(getSetting("petAlwaysOnTop"))
}

export function createPetWindow(_options?: {
  devServerUrl?: string
  indexHtml?: string
  preload?: string
}): void {
  const wm = getWindowManager()
  const existing = wm.get("pet")
  if (existing) {
    applyPetAlwaysOnTopFromStore()
    existing.focus()
    return
  }

  ensurePetSessionMediaPermission()

  const petWin = new BrowserWindow({
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
    icon: getAppIconPath(),
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      session: getPetSession(),
    },
  })

  petWin.loadURL(buildHashRouteUrl("/pet"))
  petWin.hide()
  applyPetAlwaysOnTopFromStore()

  petWin.on("closed", () => {
    wm.set("pet", null)
  })

  wm.set("pet", petWin)
}

export function showPetWindow(): void {
  if (!getSetting("petEnabled")) return

  const wm = getWindowManager()
  if (!wm.get("pet")) {
    createPetWindow()
  }

  const petWin = wm.get("pet")
  if (!petWin) return

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
  getWindowManager().get("pet")?.hide()
}

export function destroyPetWindow(): void {
  const wm = getWindowManager()
  const petWin = wm.get("pet")
  if (!petWin) return
  petWin.destroy()
  wm.set("pet", null)
}

export function getPetWin(): BrowserWindow | null {
  return getWindowManager().get("pet")
}
