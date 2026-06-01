import { app } from "electron"
import path from "node:path"
import fs from "node:fs"

function hasOfflineMarker(): boolean {
  try {
    const markerPath = app.isPackaged
      ? path.join(process.resourcesPath, "py-server", ".offline")
      : path.join(process.env.APP_ROOT!, "py-server", ".offline")
    return fs.existsSync(markerPath)
  } catch {
    return false
  }
}

export function isOfflineMode(): boolean {
  console.log("-----------------isOfflineMode-------------", hasOfflineMarker())
  if (hasOfflineMarker()) return true
  const v = process.env.OFFLINE_MODE?.trim().toLowerCase()
  return v === "1" || v === "true" || v === "yes" || v === "on"
}
