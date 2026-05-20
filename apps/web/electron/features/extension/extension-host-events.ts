import { createLogger } from "../../core/logger"
import { getWindowManager } from "../../core/services/window-registry"
import { pluginWindowId } from "../../core/services/window-manager"
import {
  EXTENSION_HOST_EVENT_CHANNEL,
  type ExtensionHostEventEnvelope,
} from "../../shared/extension-ipc-channels"
import { ExtensionPermission } from "./extension-permissions"
import { getExtensionManifest } from "./extension-registry"
import { getOpenExtensionIds } from "./extension-window"
import { isExtensionEnabled } from "./extension-store"

export { EXTENSION_HOST_EVENT_CHANNEL }

const log = createLogger("extension:events")

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
}
