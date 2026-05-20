import fs from "node:fs"
import path from "node:path"
import { createLogger } from "../../core/logger"
import { deactivateExtension } from "./extension-loader"
import { getExtensionRoot, getExtensionsRoot } from "./extension-paths"
import { clearPluginStorage } from "./extension-plugin-store"
import { scanExtensionRegistry } from "./extension-registry"
import { removeExtensionFromStore } from "./extension-store"
import { assertValidExtensionId } from "./manifest-schema"

const log = createLogger("extension:uninstall")

function assertExtensionRootSafe(extensionId: string): string {
  const extensionsRoot = path.resolve(getExtensionsRoot())
  const extRoot = path.resolve(getExtensionRoot(extensionId))
  if (
    extRoot !== extensionsRoot &&
    !extRoot.startsWith(extensionsRoot + path.sep)
  ) {
    throw new Error(`Invalid extension path: ${extensionId}`)
  }
  return extRoot
}

export async function uninstallExtension(extensionId: string): Promise<void> {
  assertValidExtensionId(extensionId)

  const extRoot = assertExtensionRootSafe(extensionId)
  if (!fs.existsSync(extRoot)) {
    throw new Error(`Extension not found: ${extensionId}`)
  }

  deactivateExtension(extensionId)

  fs.rmSync(extRoot, { recursive: true, force: true })
  removeExtensionFromStore(extensionId)
  clearPluginStorage(extensionId)
  scanExtensionRegistry()

  log.info("extension uninstalled", { extensionId })
}
