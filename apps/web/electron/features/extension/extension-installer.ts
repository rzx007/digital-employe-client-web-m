import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import JSZip from "jszip"
import { createLogger } from "../../core/logger"
import {
  ExtensionManifestSchema,
  isHostVersionCompatible,
  MANIFEST_FILE_NAME,
  normalizeManifestRaw,
} from "./manifest-schema"
import { HOST_VERSION } from "./extension-context"
import { getExtensionRoot, getExtensionsRoot } from "./extension-paths"
import { scanExtensions } from "./extension-loader"

const log = createLogger("extension:install")

function findManifestEntry(
  zip: JSZip,
): { manifestPath: string; prefix: string } | null {
  const candidates = Object.keys(zip.files).filter(
    (name) =>
      !zip.files[name]?.dir &&
      name.endsWith(MANIFEST_FILE_NAME) &&
      !name.includes("__MACOSX"),
  )
  if (candidates.length === 0) return null
  if (candidates.length > 1) {
    const atRoot = candidates.find((n) => n === MANIFEST_FILE_NAME)
    if (atRoot) {
      return { manifestPath: atRoot, prefix: "" }
    }
    throw new Error(
      "Zip contains multiple extension manifests; use a single extension per zip",
    )
  }
  const manifestPath = candidates[0]!
  const prefix = manifestPath.slice(0, -MANIFEST_FILE_NAME.length)
  return { manifestPath, prefix }
}

function assertSafeZipEntry(entryName: string, prefix: string): string {
  const relative = entryName.slice(prefix.length)
  if (!relative || relative.endsWith("/")) {
    throw new Error(`Invalid zip entry: ${entryName}`)
  }
  const normalized = path.normalize(relative.replace(/\//g, path.sep))
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error(`Zip slip detected: ${entryName}`)
  }
  return normalized
}

async function extractZipToDirectory(
  zip: JSZip,
  prefix: string,
  targetDir: string,
): Promise<void> {
  fs.mkdirSync(targetDir, { recursive: true })
  for (const [entryName, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    if (!entryName.startsWith(prefix)) continue
    if (entryName.includes("__MACOSX")) continue

    const relative = assertSafeZipEntry(entryName, prefix)
    const destPath = path.join(targetDir, relative)
    const destDir = path.dirname(destPath)
    fs.mkdirSync(destDir, { recursive: true })

    const content = await entry.async("nodebuffer")
    fs.writeFileSync(destPath, content)
  }
}

function parseManifestFromDir(extensionDir: string) {
  const manifestPath = path.join(extensionDir, MANIFEST_FILE_NAME)
  const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as unknown
  const { value } = normalizeManifestRaw(raw)
  return ExtensionManifestSchema.parse(value)
}

function removeDirRecursive(dir: string): void {
  if (!fs.existsSync(dir)) return
  fs.rmSync(dir, { recursive: true, force: true })
}

/**
 * 从 zip 安装插件（五期无签名校验）
 */
export async function installExtensionFromZip(
  zipFilePath: string,
): Promise<{ extensionId: string }> {
  const resolvedZip = path.resolve(zipFilePath)
  if (!fs.existsSync(resolvedZip)) {
    throw new Error(`Zip file not found: ${resolvedZip}`)
  }

  const buffer = fs.readFileSync(resolvedZip)
  const zip = await JSZip.loadAsync(buffer)
  const located = findManifestEntry(zip)
  if (!located) {
    throw new Error(`Zip does not contain ${MANIFEST_FILE_NAME}`)
  }

  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "de-extension-install-"),
  )

  try {
    await extractZipToDirectory(zip, located.prefix, tempRoot)
    const manifest = parseManifestFromDir(tempRoot)

    if (!isHostVersionCompatible(HOST_VERSION, manifest.minHostVersion)) {
      throw new Error(
        `Extension requires host ${manifest.minHostVersion}, current ${HOST_VERSION}`,
      )
    }

    const destRoot = getExtensionRoot(manifest.id)
    if (fs.existsSync(destRoot)) {
      throw new Error(
        `Extension already installed: ${manifest.id}. Remove it before reinstalling.`,
      )
    }

    const extensionsRoot = path.resolve(getExtensionsRoot())
    const resolvedDest = path.resolve(destRoot)
    if (
      resolvedDest !== extensionsRoot &&
      !resolvedDest.startsWith(extensionsRoot + path.sep)
    ) {
      throw new Error("Invalid extension install path")
    }

    fs.renameSync(tempRoot, destRoot)
    scanExtensions()
    log.info("extension installed from zip", { id: manifest.id, resolvedZip })
    return { extensionId: manifest.id }
  } catch (err) {
    removeDirRecursive(tempRoot)
    throw err
  }
}
