import { createLogger } from "../../core/logger"
import { getWindowManager } from "../../core/services/window-registry"
import { pluginWindowId } from "../../core/services/window-manager"
import {
  EXTENSION_HOST_EVENT_CHANNEL,
  type ExtensionHostEventEnvelope,
} from "../../shared/extension-ipc-channels"
import { ExtensionPermission } from "./extension-permissions"
import {
  getExtensionManifest,
  listDiscoveredExtensions,
} from "./extension-registry"
import { getServiceBaseUrl } from "./extension-service-host"
import { isHeadlessExtension } from "./manifest-schema"
import { getOpenExtensionIds } from "./extension-window"
import { isExtensionEnabled } from "./extension-store"

export { EXTENSION_HOST_EVENT_CHANNEL }

const log = createLogger("extension:events")

const DEFAULT_HEADLESS_HOST_EVENTS_PATH = "/_digital-employee/host-events"

async function postHostEventToHeadlessServices(
  envelope: ExtensionHostEventEnvelope,
): Promise<void> {
  for (const manifest of listDiscoveredExtensions()) {
    if (!isHeadlessExtension(manifest)) continue
    if (!isExtensionEnabled(manifest.id)) continue
    if (!manifest.permissions.includes(ExtensionPermission.hostEvents)) {
      continue
    }

    const baseUrl = getServiceBaseUrl(manifest.id)
    if (!baseUrl) continue

    const eventsPath =
      manifest.service.hostEventsPath ?? DEFAULT_HEADLESS_HOST_EVENTS_PATH
    const url = new URL(
      eventsPath,
      baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
    )

    try {
      const response = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) {
        log.warn("headless host event POST failed", {
          extensionId: manifest.id,
          status: response.status,
          type: envelope.type,
        })
        continue
      }
      log.debug("headless host event sent", {
        extensionId: manifest.id,
        type: envelope.type,
      })
    } catch (err) {
      log.warn("headless host event POST error", {
        extensionId: manifest.id,
        type: envelope.type,
        err,
      })
    }
  }
}

export function emitHostEvent(
  type: string,
  payload?: unknown,
): void {
  const envelope: ExtensionHostEventEnvelope = {
    type,
    payload,
    timestamp: Date.now(),
  }

  for (const extensionId of getOpenExtensionIds()) {
    if (!isExtensionEnabled(extensionId)) continue

    const manifest = getExtensionManifest(extensionId)
    if (!manifest?.permissions.includes(ExtensionPermission.hostEvents)) {
      continue
    }

    const win = getWindowManager().get(pluginWindowId(extensionId))
    if (!win || win.isDestroyed()) continue

    win.webContents.send(EXTENSION_HOST_EVENT_CHANNEL, envelope)
    log.debug("host event sent", { extensionId, type })
  }

  void postHostEventToHeadlessServices(envelope)
}
