import fs from "node:fs"
import path from "node:path"
import { app } from "electron"
import { createLogger } from "../../core/logger"
import {
  ExtensionManifestSchema,
  isHostVersionCompatible,
  MANIFEST_FILE_NAME,
  normalizeManifestRaw,
  type ExtensionManifest,
} from "./manifest-schema"
import {
  extensionIdToEnvKey,
  getExtensionRoot,
  getExtensionsRoot,
  isAllowedDevUrl,
} from "./extension-paths"
import { getDevOverride } from "./extension-store"
import { HOST_VERSION } from "./extension-context"

const log = createLogger("extension")

const discovered = new Map<string, ExtensionManifest>()
const activated = new Set<string>()

export function scanExtensionRegistry(): ExtensionManifest[] {
  discovered.clear()
  const root = getExtensionsRoot()
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch (err) {
    log.warn("failed to read extensions root", { err })
    return []
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const extensionId = entry.name
    const manifestPath = path.join(root, extensionId, MANIFEST_FILE_NAME)
    if (!fs.existsSync(manifestPath)) continue

    try {
      const parsed = JSON.parse(
        fs.readFileSync(manifestPath, "utf-8"),
      ) as unknown
      const { value: raw, removed } = normalizeManifestRaw(parsed)
      if (removed.length > 0) {
        log.info("removed deprecated manifest fields", {
          extensionId,
          removed,
        })
      }
      const manifest = ExtensionManifestSchema.parse(raw)
      if (manifest.id !== extensionId) {
        log.warn("manifest id does not match folder name", {
          folder: extensionId,
          manifestId: manifest.id,
        })
        continue
      }
      if (!isHostVersionCompatible(HOST_VERSION, manifest.minHostVersion)) {
        log.warn("extension requires newer host", {
          id: manifest.id,
          minHostVersion: manifest.minHostVersion,
          hostVersion: HOST_VERSION,
        })
        continue
      }
      discovered.set(manifest.id, manifest)
    } catch (err) {
      log.warn("invalid extension manifest", { extensionId, err })
    }
  }

  log.info("extensions scanned", { count: discovered.size })
  return [...discovered.values()]
}

export function getExtensionManifest(
  extensionId: string,
): ExtensionManifest | undefined {
  return discovered.get(extensionId)
}

export function listDiscoveredExtensions(): ExtensionManifest[] {
  return [...discovered.values()]
}

export function markExtensionActivated(extensionId: string): void {
  activated.add(extensionId)
}

export function markExtensionDeactivated(extensionId: string): void {
  activated.delete(extensionId)
}

export function clearActivatedExtensions(): void {
  activated.clear()
}

export function resolveExtensionUiTarget(extensionId: string): {
  loadFile?: string
  loadUrl?: string
} {
  const manifest = discovered.get(extensionId)
  if (!manifest) {
    throw new Error(`Extension not found: ${extensionId}`)
  }

  const devUrl = resolveDevEntry(extensionId, manifest)
  if (devUrl) {
    return { loadUrl: devUrl }
  }

  const entryPath = path.join(
    getExtensionRoot(extensionId),
    manifest.ui.entry,
  )
  if (!fs.existsSync(entryPath)) {
    throw new Error(`Extension UI entry not found: ${entryPath}`)
  }
  return { loadFile: entryPath }
}

function resolveDevEntry(
  extensionId: string,
  manifest: ExtensionManifest,
): string | undefined {
  if (app.isPackaged) return undefined

  const envKey = extensionIdToEnvKey(extensionId)
  const fromEnv = process.env[envKey]
  if (fromEnv && isAllowedDevUrl(fromEnv)) {
    return fromEnv
  }

  const fromStore = getDevOverride(extensionId)
  if (fromStore && isAllowedDevUrl(fromStore)) {
    return fromStore
  }

  if (manifest.ui.devEntry && isAllowedDevUrl(manifest.ui.devEntry)) {
    return manifest.ui.devEntry
  }

  return undefined
}
