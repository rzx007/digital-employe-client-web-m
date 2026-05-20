import { is } from "@electron-toolkit/utils"
import type { WebContents } from "electron"
import { getWindowManager } from "../../core/services/window-registry"
import { getExtensionPreloadPath } from "../../core/runtime-paths"
import { pluginWindowId } from "../../core/services/window-manager"
import { createLogger } from "../../core/logger"
import {
  getExtensionManifest,
  markExtensionActivated,
  resolveExtensionUiTarget,
} from "./extension-registry"
import { hasExtensionService, hasExtensionUi } from "./manifest-schema"
import {
  getServiceBaseUrl,
  startExtensionService,
  stopExtensionService,
} from "./extension-service-host"
import { pinBrowserWindowTitle } from "../../main/pin-window-title"

const log = createLogger("extension")

const webContentsToExtensionId = new Map<number, string>()
const openExtensionIds = new Set<string>()

export function getExtensionIdForWebContents(
  webContents: WebContents,
): string | undefined {
  return webContentsToExtensionId.get(webContents.id)
}

export function getExtensionServiceBaseUrl(
  extensionId: string,
): string | undefined {
  return getServiceBaseUrl(extensionId)
}

export async function openExtensionWindow(
  extensionId: string,
): Promise<void> {
  const manifest = getExtensionManifest(extensionId)
  if (!manifest) {
    throw new Error(`Extension not found: ${extensionId}`)
  }
  if (!hasExtensionUi(manifest)) {
    throw new Error(`Extension has no UI: ${extensionId}`)
  }

  if (hasExtensionService(manifest)) {
    await startExtensionService(extensionId)
  }

  const wm = getWindowManager()
  const winId = pluginWindowId(extensionId)
  const existing = wm.focus(winId)
  if (existing) {
    webContentsToExtensionId.set(existing.webContents.id, extensionId)
    return
  }

  markExtensionActivated(extensionId)
  const uiTarget = resolveExtensionUiTarget(extensionId)

  const win = wm.createWindow({
    id: winId,
    preloadPath: getExtensionPreloadPath(),
    ...uiTarget,
    overrides: {
      width: manifest.ui!.width,
      height: manifest.ui!.height,
      minWidth: Math.min(640, manifest.ui!.width),
      minHeight: Math.min(480, manifest.ui!.height),
      title: manifest.ui!.title,
      show: false,
    },
    onCreated: (w) => {
      webContentsToExtensionId.set(w.webContents.id, extensionId)
      pinBrowserWindowTitle(w, manifest.ui!.title)
      w.once("ready-to-show", () => w.show())
      if (is.dev) {
        w.webContents.openDevTools({ mode: "detach" })
      }
    },
  })

  openExtensionIds.add(extensionId)

  const webContentsId = win.webContents.id
  win.on("closed", () => {
    webContentsToExtensionId.delete(webContentsId)
    openExtensionIds.delete(extensionId)
    if (hasExtensionService(manifest)) {
      stopExtensionService(extensionId)
    }
  })

  log.info("extension window opened", { extensionId })
}

export function closeExtensionWindow(extensionId: string): void {
  const manifest = getExtensionManifest(extensionId)
  getWindowManager().close(pluginWindowId(extensionId))
  if (manifest && hasExtensionService(manifest)) {
    stopExtensionService(extensionId)
  }
}

export function closeAllExtensionWindows(): void {
  for (const extensionId of [...openExtensionIds]) {
    closeExtensionWindow(extensionId)
  }
}
