import { session, webContents } from "electron"
import { createLogger } from "../../core/logger"
import { getStoredAuth } from "../auth/auth-store"
import { getExtensionManifest } from "./extension-registry"
import { evaluateExtensionRequest } from "./extension-network-policy"
import { ExtensionPermission } from "./extension-permissions"
import { getExtensionIdForWebContents } from "./extension-window"

const log = createLogger("extension:network")

const NETWORK_URL_FILTER = [
  "http://*/*",
  "https://*/*",
  "ws://*/*",
  "wss://*/*",
]

let guardRegistered = false

function hasAuthorizationHeader(
  headers: Record<string, string | string[]>,
): boolean {
  return Object.keys(headers).some(
    (key) => key.toLowerCase() === "authorization",
  )
}

function resolveExtensionIdFromDetails(
  webContentsId: number | undefined,
): string | undefined {
  if (webContentsId == null) return undefined
  const wc = webContents.fromId(webContentsId)
  if (!wc || wc.isDestroyed()) return undefined
  return getExtensionIdForWebContents(wc)
}

export function registerExtensionNetworkGuard(): void {
  if (guardRegistered) return
  guardRegistered = true

  const ses = session.defaultSession

  ses.webRequest.onBeforeRequest(
    { urls: NETWORK_URL_FILTER },
    (details, callback) => {
      const extensionId = resolveExtensionIdFromDetails(details.webContentsId)
      if (!extensionId) {
        callback({})
        return
      }

      const decision = evaluateExtensionRequest(extensionId, details.url)
      if (!decision.allow) {
        log.warn("request blocked", {
          extensionId,
          url: details.url,
          reason: decision.reason,
        })
        callback({ cancel: true })
        return
      }

      callback({})
    },
  )

  ses.webRequest.onBeforeSendHeaders(
    { urls: NETWORK_URL_FILTER },
    (details, callback) => {
      const extensionId = resolveExtensionIdFromDetails(details.webContentsId)
      if (!extensionId) {
        callback({ requestHeaders: details.requestHeaders })
        return
      }

      const decision = evaluateExtensionRequest(extensionId, details.url)
      if (!decision.allow) {
        callback({ requestHeaders: details.requestHeaders })
        return
      }

      const manifest = getExtensionManifest(extensionId)
      if (
        !manifest?.permissions.includes(ExtensionPermission.authRead) ||
        hasAuthorizationHeader(details.requestHeaders)
      ) {
        callback({ requestHeaders: details.requestHeaders })
        return
      }

      const auth = getStoredAuth()
      if (!auth.token) {
        callback({ requestHeaders: details.requestHeaders })
        return
      }

      callback({
        requestHeaders: {
          ...details.requestHeaders,
          Authorization: `Bearer ${auth.token}`,
        },
      })
    },
  )

  log.info("extension network guard registered")
}
