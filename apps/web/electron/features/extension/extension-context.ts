import pkg from "../../../package.json"
import { getStoredAuth } from "../auth/auth-store"
import type { ExtensionManifest } from "./manifest-schema"
import type { ExtensionContextPayload } from "../../shared/extension-ipc-channels"

export const HOST_VERSION = pkg.version

export function buildExtensionContext(
  manifest: ExtensionManifest,
): ExtensionContextPayload {
  const ctx: ExtensionContextPayload = {
    pluginId: manifest.id,
    displayName: manifest.displayName,
    version: manifest.version,
    hostVersion: HOST_VERSION,
  }

  if (manifest.permissions.includes("auth.read")) {
    const auth = getStoredAuth()
    if (auth.token) {
      ctx.authToken = auth.token
    }
  }

  return ctx
}
