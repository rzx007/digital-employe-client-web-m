import pkg from "../../../package.json"
import { getStoredAuth } from "../auth/auth-store"
import type { ExtensionManifest } from "./manifest-schema"
import type { ExtensionContextPayload } from "../../shared/extension-ipc-channels"

export const HOST_VERSION = pkg.version

export function buildExtensionContext(
  manifest: ExtensionManifest,
  options?: { serviceBaseUrl?: string },
): ExtensionContextPayload {
  const ctx: ExtensionContextPayload = {
    pluginId: manifest.id,
    displayName: manifest.displayName,
    version: manifest.version,
    hostVersion: HOST_VERSION,
    permissions: [...manifest.permissions],
  }

  if (options?.serviceBaseUrl) {
    ctx.serviceBaseUrl = options.serviceBaseUrl
  }

  if (manifest.permissions.includes("auth.read")) {
    const auth = getStoredAuth()
    if (auth.token) {
      ctx.authToken = auth.token
    }
  }

  return ctx
}
