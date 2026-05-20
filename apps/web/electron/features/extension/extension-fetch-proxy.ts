import { app } from "electron"
import { z } from "zod"
import { createLogger } from "../../core/logger"
import { getStoredAuth } from "../auth/auth-store"
import type { ExtensionManifest } from "./manifest-schema"
import type { ExtensionFetchResponse } from "../../shared/extension-ipc-channels"
import {
  assertExtensionPermission,
  ExtensionPermission,
} from "./extension-permissions"

const log = createLogger("extension:fetch")

const MAX_BODY_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 30_000

const FetchInitSchema = z.object({
  method: z.string().optional(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
})

function isDevAllowLocalhost(): boolean {
  return !app.isPackaged || process.env.NODE_ENV === "development"
}

function hostnameMatchesAllowlist(hostname: string, pattern: string): boolean {
  const host = hostname.toLowerCase()
  const pat = pattern.toLowerCase()
  if (pat.startsWith("*.")) {
    const suffix = pat.slice(1)
    return host === pat.slice(2) || host.endsWith(suffix)
  }
  return host === pat
}

function isPrivateOrLocalHost(hostname: string): boolean {
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

function assertNetworkAllowed(manifest: ExtensionManifest, target: URL): void {
  assertExtensionPermission(manifest, ExtensionPermission.hostNetwork)

  const allowlist = manifest.network?.allowlist ?? []
  if (allowlist.length === 0) {
    throw new Error(
      `Extension ${manifest.id} has no network.allowlist configured`,
    )
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error(`Unsupported fetch protocol: ${target.protocol}`)
  }

  const hostname = target.hostname
  if (isPrivateOrLocalHost(hostname)) {
    if (!(isDevAllowLocalhost() && (hostname === "localhost" || hostname === "127.0.0.1"))) {
      throw new Error(`Fetch to private or local address is not allowed: ${hostname}`)
    }
  }

  const allowed = allowlist.some((pattern) =>
    hostnameMatchesAllowlist(hostname, pattern),
  )
  if (!allowed) {
    throw new Error(`Host not in network.allowlist: ${hostname}`)
  }
}

function flattenHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    out[key] = value
  })
  return out
}

export async function proxyExtensionFetch(
  manifest: ExtensionManifest,
  input: string,
  init?: unknown,
): Promise<ExtensionFetchResponse> {
  let target: URL
  try {
    target = new URL(input)
  } catch {
    throw new Error(`Invalid fetch URL: ${input}`)
  }

  assertNetworkAllowed(manifest, target)

  const options = FetchInitSchema.parse(init ?? {})
  const headers = new Headers(options.headers ?? {})

  if (
    manifest.permissions.includes(ExtensionPermission.authRead) &&
    !headers.has("Authorization")
  ) {
    const auth = getStoredAuth()
    if (auth.token) {
      headers.set("Authorization", `Bearer ${auth.token}`)
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(target.toString(), {
      method: options.method ?? "GET",
      headers,
      body: options.body,
      signal: controller.signal,
      redirect: "manual",
    })

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength > MAX_BODY_BYTES) {
      throw new Error(
        `Response body exceeds limit (${MAX_BODY_BYTES} bytes)`,
      )
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (location) {
        let redirectUrl: URL
        try {
          redirectUrl = new URL(location, target)
        } catch {
          throw new Error(`Invalid redirect location: ${location}`)
        }
        assertNetworkAllowed(manifest, redirectUrl)
        throw new Error(
          "Redirects are not followed automatically; retry the redirect URL explicitly",
        )
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      headers: flattenHeaders(response.headers),
      body: buffer.toString("utf-8"),
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Fetch timed out after ${TIMEOUT_MS}ms`)
    }
    log.warn("fetch failed", { id: manifest.id, url: input, err })
    throw err
  } finally {
    clearTimeout(timer)
  }
}
