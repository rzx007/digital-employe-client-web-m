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
  isHeadlessExtension,
} from "./manifest-schema"
import {
  getEnabledExtensionIds,
  initExtensionStore,
  isExtensionEnabled,
} from "./extension-store"
import {
  isExtensionServiceRunning,
  startExtensionService,
  stopAllExtensionServices,
  stopExtensionService,
} from "./extension-service-host"
import {
  closeAllExtensionWindows,
  closeExtensionWindow,
} from "./extension-window"

const log = createLogger("extension")

export function initExtensions(): void {
  initExtensionStore()
  scanExtensionRegistry()
  void restoreEnabledExtensions()
}

async function restoreEnabledExtensions(): Promise<void> {
  for (const id of getEnabledExtensionIds()) {
    if (!getExtensionManifest(id)) {
      log.warn("enabled extension not found on disk", { id })
      continue
    }
    try {
      await activateExtension(id)
    } catch (err) {
      log.warn("failed to activate extension on init", { id, err })
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
  hasUi: boolean
  hasService: boolean
  serviceRunning: boolean
  enabled: boolean
}> {
  return listDiscoveredExtensions().map((m) => ({
    id: m.id,
    version: m.version,
    displayName: m.displayName,
    hasUi: m.ui != null,
    hasService: m.service != null,
    serviceRunning: isExtensionServiceRunning(m.id),
    enabled: isExtensionEnabled(m.id),
  }))
}

export { getExtensionManifest } from "./extension-registry"

export async function activateExtension(extensionId: string): Promise<void> {
  const manifest = getExtensionManifest(extensionId)
  if (!manifest) {
    throw new Error(`Extension not found: ${extensionId}`)
  }
  markExtensionActivated(extensionId)
  if (isHeadlessExtension(manifest)) {
    await startExtensionService(extensionId)
  }
  log.info("extension activated", { extensionId })
}

export function deactivateExtension(extensionId: string): void {
  closeExtensionWindow(extensionId)
  stopExtensionService(extensionId)
  markExtensionDeactivated(extensionId)
  log.info("extension deactivated", { extensionId })
}

export function deactivateAllExtensions(): void {
  stopAllExtensionServices()
  closeAllExtensionWindows()
  clearActivatedExtensions()
}
