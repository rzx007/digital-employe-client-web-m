import { createLogger } from "../../core/logger"
import {
  clearActivatedExtensions,
  getExtensionManifest,
  listDiscoveredExtensions,
  markExtensionActivated,
  markExtensionDeactivated,
  scanExtensionRegistry,
} from "./extension-registry"
import {
  getEnabledExtensionIds,
  initExtensionStore,
  isExtensionEnabled,
} from "./extension-store"
import {
  closeAllExtensionWindows,
  closeExtensionWindow,
} from "./extension-window"

const log = createLogger("extension")

export function initExtensions(): void {
  initExtensionStore()
  scanExtensionRegistry()
  for (const id of getEnabledExtensionIds()) {
    if (getExtensionManifest(id)) {
      activateExtension(id)
    } else {
      log.warn("enabled extension not found on disk", { id })
    }
  }
}

export function scanExtensions(): void {
  scanExtensionRegistry()
}

export function listExtensions(): Array<{
  id: string
  version: string
  displayName: string
  kind: string
  enabled: boolean
}> {
  return listDiscoveredExtensions().map((m) => ({
    id: m.id,
    version: m.version,
    displayName: m.displayName,
    kind: m.kind,
    enabled: isExtensionEnabled(m.id),
  }))
}

export { getExtensionManifest } from "./extension-registry"

export function activateExtension(extensionId: string): void {
  if (!getExtensionManifest(extensionId)) {
    throw new Error(`Extension not found: ${extensionId}`)
  }
  markExtensionActivated(extensionId)
  log.info("extension activated", { extensionId })
}

export function deactivateExtension(extensionId: string): void {
  closeExtensionWindow(extensionId)
  markExtensionDeactivated(extensionId)
  log.info("extension deactivated", { extensionId })
}

export function deactivateAllExtensions(): void {
  closeAllExtensionWindows()
  clearActivatedExtensions()
}
