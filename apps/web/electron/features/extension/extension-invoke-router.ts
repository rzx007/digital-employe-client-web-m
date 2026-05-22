import { z } from "zod"
import { getBackendPort, getBackendStatus } from "../backend/backend-process"
import { sendNotification } from "../notification-tray/notification"
import { showMainWindow } from "../notification-tray/tray"
import { createRecruitmentWindow } from "../recruitment/window-recruitment"
import { hidePetWindow, showPetWindow } from "../pet/pet-window"
import { createSettingsWindow } from "../settings/window-settings"
import { getWindowManager } from "../../core/services/window-registry"
import type { ExtensionManifest } from "./manifest-schema"
import { assertInvokeMethodAllowed } from "./extension-permissions"
import {
  getPluginStorageValue,
  setPluginStorageValue,
} from "./extension-plugin-store"

const NotificationPayloadSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  silent: z.boolean().optional(),
})

const StorageGetSchema = z.object({
  key: z.string().min(1),
})

const StorageSetSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
})

const OpenSettingsPayloadSchema = z.object({
  tab: z
    .enum([
      "account",
      "general",
      "shortcuts",
      "models",
      "pet",
      "extensions",
      "about",
    ])
    .optional(),
})

export async function dispatchExtensionInvoke(
  extensionId: string,
  manifest: ExtensionManifest,
  method: string,
  payload: unknown,
): Promise<unknown> {
  assertInvokeMethodAllowed(manifest, method)

  switch (method) {
    case "notification.show": {
      const data = NotificationPayloadSchema.parse(payload ?? {})
      const main = getWindowManager().getMain()
      if (!main) {
        throw new Error("Main window is not available")
      }
      sendNotification({
        title: data.title,
        body: data.body,
        silent: data.silent,
        win: main,
      })
      return undefined
    }
    case "window.focusMain": {
      const main = getWindowManager().getMain()
      if (!main) {
        throw new Error("Main window is not available")
      }
      showMainWindow(main)
      return undefined
    }
    case "storage.get": {
      const { key } = StorageGetSchema.parse(payload ?? {})
      return getPluginStorageValue(extensionId, key)
    }
    case "storage.set": {
      const { key, value } = StorageSetSchema.parse(payload ?? {})
      setPluginStorageValue(extensionId, key, value)
      return undefined
    }
    case "backend.getPort": {
      return { port: getBackendPort() }
    }
    case "backend.health": {
      const status = getBackendStatus()
      let healthy = false
      if (status.ready && status.running) {
        try {
          const response = await fetch(
            `http://127.0.0.1:${status.port}/health`,
            { signal: AbortSignal.timeout(3_000) },
          )
          healthy = response.ok
        } catch {
          healthy = false
        }
      }
      return {
        ready: status.ready,
        running: status.running,
        port: status.port,
        healthy,
      }
    }
    case "window.openSettings": {
      const data = OpenSettingsPayloadSchema.parse(payload ?? {})
      createSettingsWindow({ tab: data.tab })
      return undefined
    }
    case "pet.show": {
      showPetWindow()
      return undefined
    }
    case "pet.hide": {
      hidePetWindow()
      return undefined
    }
    case "recruitment.open": {
      createRecruitmentWindow()
      return undefined
    }
    default:
      throw new Error(`Unhandled extension.invoke method: ${method}`)
  }
}
