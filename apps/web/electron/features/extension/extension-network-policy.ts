import { getBackendPort } from "../backend/backend-process"
import { getExtensionManifest, getExtensionDevOrigin } from "./extension-registry"
import { getServiceBaseUrl } from "./extension-service-host"
import {
  assertExtensionPermission,
  ExtensionPermission,
} from "./extension-permissions"
import type { ExtensionManifest } from "./manifest-schema"

const NETWORK_PROTOCOLS = new Set([
  "http:",
  "https:",
  "ws:",
  "wss:",
])

export interface ExtensionRequestDecision {
  allow: boolean
  reason?: string
}

export function hostnameMatchesAllowlist(
  hostname: string,
  pattern: string,
): boolean {
  const host = hostname.toLowerCase()
  const pat = pattern.toLowerCase()
  if (pat.startsWith("*.")) {
    const suffix = pat.slice(1)
    return host === pat.slice(2) || host.endsWith(suffix)
  }
  return host === pat
}

export function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost")) return true
  if (host === "::1" || host === "[::1]") return true

  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const parts = host.split(".").map((p) => parseInt(p, 10))
    const [a, b] = parts
    if (a === 127) return true
    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a === 0) return true
  }
  return false
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === "localhost" || host === "127.0.0.1" || host === "::1"
}

function getEffectivePort(url: URL): number {
  if (url.port) return parseInt(url.port, 10)
  if (url.protocol === "https:" || url.protocol === "wss:") return 443
  if (url.protocol === "http:" || url.protocol === "ws:") return 80
  return 0
}

function isMainBackendUrl(url: URL): boolean {
  if (!isLoopbackHost(url.hostname)) return false
  return getEffectivePort(url) === getBackendPort()
}

function matchesServiceOrigin(
  extensionId: string,
  url: URL,
): boolean {
  const base = getServiceBaseUrl(extensionId)
  if (!base) return false
  try {
    return new URL(base).origin === url.origin
  } catch {
    return false
  }
}

function matchesAllowlist(manifest: ExtensionManifest, url: URL): boolean {
  try {
    assertExtensionPermission(manifest, ExtensionPermission.hostNetwork)
  } catch {
    return false
  }

  const allowlist = manifest.network?.allowlist ?? []
  if (allowlist.length === 0) return false

  return allowlist.some((pattern) =>
    hostnameMatchesAllowlist(url.hostname, pattern),
  )
}

export function evaluateExtensionRequest(
  extensionId: string,
  urlString: string,
): ExtensionRequestDecision {
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    return { allow: false, reason: "invalid URL" }
  }

  if (!NETWORK_PROTOCOLS.has(url.protocol)) {
    return { allow: true }
  }

  if (isMainBackendUrl(url)) {
    return {
      allow: false,
      reason: `blocked main backend port ${getBackendPort()}`,
    }
  }

  if (matchesServiceOrigin(extensionId, url)) {
    return { allow: true }
  }

  const devOrigin = getExtensionDevOrigin(extensionId)
  if (devOrigin && url.origin === devOrigin) {
    return { allow: true }
  }

  const manifest = getExtensionManifest(extensionId)
  if (!manifest) {
    return { allow: false, reason: "extension not found" }
  }

  if (matchesAllowlist(manifest, url)) {
    if (isPrivateOrLocalHost(url.hostname)) {
      return {
        allow: false,
        reason: `private/local host not in allowlist path: ${url.hostname}`,
      }
    }
    return { allow: true }
  }

  if (isPrivateOrLocalHost(url.hostname)) {
    return {
      allow: false,
      reason: `blocked private/local: ${url.hostname}`,
    }
  }

  return {
    allow: false,
    reason: "host not allowed (missing host.network or not in allowlist)",
  }
}
