import fs from "node:fs"
import path from "node:path"
import { getStoreDir } from "../settings/settings-store"
import { MANIFEST_FILE_NAME } from "./manifest-schema"

export function getExtensionsRoot(): string {
  const root = path.join(getStoreDir(), "extensions")
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true })
  }
  return root
}

export function getExtensionRoot(extensionId: string): string {
  return path.join(getExtensionsRoot(), extensionId)
}

export function getManifestPath(extensionId: string): string {
  return path.join(getExtensionRoot(extensionId), MANIFEST_FILE_NAME)
}

/**
 * 解析扩展内相对路径，禁止目录穿越
 */
export function resolveExtensionPath(
  extensionId: string,
  relativePath: string,
): string {
  const extRoot = path.resolve(getExtensionRoot(extensionId))
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "")
  const resolved = path.resolve(extRoot, normalized)
  if (
    resolved !== extRoot &&
    !resolved.startsWith(extRoot + path.sep)
  ) {
    throw new Error(`Path escapes extension root: ${relativePath}`)
  }
  return resolved
}

/** com.example.demo → EXTENSION_DEV_COM_EXAMPLE_DEMO */
export function extensionIdToEnvKey(extensionId: string): string {
  return `EXTENSION_DEV_${extensionId.replace(/\./g, "_").toUpperCase()}`
}

/** 开发态 URL 仅允许本机 */
export function isAllowedDevUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false
  }
  const host = parsed.hostname.toLowerCase()
  return host === "localhost" || host === "127.0.0.1"
}
