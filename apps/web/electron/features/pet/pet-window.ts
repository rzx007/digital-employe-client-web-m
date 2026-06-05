import { BrowserWindow, screen, session, type Session } from "electron"
import { getWindowManager } from "../../core/services/window-registry"
import { getSetting } from "../settings/settings-store"
import { handlePetdexRequest } from "../../core/petdex-protocol"
import {
  PET_WINDOW_HEIGHT,
  PET_WINDOW_MARGIN,
  PET_WINDOW_WIDTH,
} from "./pet-window-size"

const PET_TRANSPARENT_BG = "#00000000"

function applyPetWindowSurface(win: BrowserWindow): void {
  win.setBackgroundColor(PET_TRANSPARENT_BG)
  if (process.platform === "linux") {
    win.once("show", () => {
      if (!win.isDestroyed()) {
        win.setBackgroundColor(PET_TRANSPARENT_BG)
      }
    })
  }
}

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

export function applyPetAlwaysOnTopFromStore(): void {
  const petWin = getWindowManager().get("pet")
  if (!petWin) return
  petWin.setAlwaysOnTop(getSetting("petAlwaysOnTop"))
}

export function createPetWindow(): void {
  const wm = getWindowManager()
  if (wm.get("pet")) {
    applyPetAlwaysOnTopFromStore()
    wm.focus("pet")
    return
  }

  ensurePetSessionMediaPermission()

  wm.createWindow({
    id: "pet",
    route: "/pet",
    overrides: {
      width: PET_WINDOW_WIDTH,
      height: PET_WINDOW_HEIGHT,
      title: "DigitalEmployee-Pet",
      frame: false,
      transparent: true,
      backgroundColor: PET_TRANSPARENT_BG,
      alwaysOnTop: getSetting("petAlwaysOnTop"),
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: { session: getPetSession() },
    },
    onCreated: (win) => {
      win.hide()
      applyPetWindowSurface(win)
      applyPetAlwaysOnTopFromStore()
    },
  })
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
  applyPetWindowSurface(petWin)
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
