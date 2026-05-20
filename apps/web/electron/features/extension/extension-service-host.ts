import { createLogger } from "../../core/logger"
import {
  startManagedProcess,
  type ManagedProcessHandle,
} from "../../core/services/managed-process"
import { getExtensionManifest } from "./extension-registry"
import { resolveExtensionPath } from "./extension-paths"
import type { ExtensionServiceManifest } from "./manifest-schema"

const log = createLogger("extension:service")

interface RunningService {
  extensionId: string
  port: number
  baseUrl: string
  managed: ManagedProcessHandle
}

const runningServices = new Map<string, RunningService>()

function resolveServiceCommand(
  extensionId: string,
  service: ExtensionServiceManifest,
): string[] {
  const command = [...service.command]
  if (service.bundledBinary) {
    const binaryPath = resolveExtensionPath(extensionId, service.bundledBinary)
    command[0] = binaryPath
  }
  return command
}

function assertNoShellMetacharacters(argv: string[]): void {
  const unsafe = /[;&|`$<>]/
  for (const part of argv) {
    if (unsafe.test(part)) {
      throw new Error(`Invalid service command argument: ${part}`)
    }
  }
}

export function isExtensionServiceRunning(extensionId: string): boolean {
  return runningServices.has(extensionId)
}

export function getServiceBaseUrl(extensionId: string): string | undefined {
  return runningServices.get(extensionId)?.baseUrl
}

export async function startExtensionService(
  extensionId: string,
): Promise<string> {
  const existing = runningServices.get(extensionId)
  if (existing) {
    return existing.baseUrl
  }

  const manifest = getExtensionManifest(extensionId)
  if (!manifest) {
    throw new Error(`Extension not found: ${extensionId}`)
  }
  if (manifest.kind !== "ui-service" || !manifest.service) {
    throw new Error(`Extension has no service: ${extensionId}`)
  }

  const service = manifest.service
  assertNoShellMetacharacters(service.command)

  const cwd = resolveExtensionPath(extensionId, service.cwd)
  const command = resolveServiceCommand(extensionId, service)

  const readyTimeoutMs =
    service.ready.type === "health"
      ? service.ready.timeoutMs
      : 30_000

  try {
    const managed = await startManagedProcess({
      command,
      cwd,
      env: service.env,
      host: service.host,
      port: service.port > 0 ? service.port : undefined,
      envPortKey: service.envPortKey,
      ready: service.ready,
      readyTimeoutMs,
      logScope: `extension:service:${extensionId}`,
    })

    const entry: RunningService = {
      extensionId,
      port: managed.port,
      baseUrl: managed.baseUrl,
      managed,
    }
    runningServices.set(extensionId, entry)
    log.info("service started", { extensionId, baseUrl: managed.baseUrl })
    return managed.baseUrl
  } catch (err) {
    stopExtensionService(extensionId)
    throw err
  }
}

export function stopExtensionService(extensionId: string): void {
  const entry = runningServices.get(extensionId)
  if (!entry) return

  entry.managed.stop()
  runningServices.delete(extensionId)
  log.info("service stopped", { extensionId })
}

export function stopAllExtensionServices(): void {
  for (const id of [...runningServices.keys()]) {
    stopExtensionService(id)
  }
}
