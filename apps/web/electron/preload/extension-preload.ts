import { contextBridge, ipcRenderer } from "electron"
import log from "electron-log/preload"
import {
  EXTENSION_HOST_EVENT_CHANNEL,
  ExtensionPluginIpcChannels,
  type ExtensionContextPayload,
  type ExtensionHostEventEnvelope,
  type ExtensionInvokeMethodDescriptor,
  type ExtensionPluginIpcChannel,
  type ExtensionPluginIpcResult,
} from "../shared/extension-ipc-channels"

function extensionInvoke<C extends ExtensionPluginIpcChannel>(
  channel: C,
  ...args: unknown[]
): Promise<ExtensionPluginIpcResult<C>> {
  return ipcRenderer
    .invoke(channel, ...args)
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      log.warn(`[extension-preload:invoke] ${channel} failed`, {
        channel,
        message,
      })
      throw err
    }) as Promise<ExtensionPluginIpcResult<C>>
}

let cachedPermissions: string[] | null = null

async function ensurePermissions(): Promise<string[]> {
  if (cachedPermissions) return cachedPermissions
  const ctx = await extensionInvoke(ExtensionPluginIpcChannels.getContext)
  cachedPermissions = ctx.permissions ?? []
  return cachedPermissions
}

const extensionApi = {
  apiVersion: 1 as const,
  getPluginId: () =>
    extensionInvoke(ExtensionPluginIpcChannels.getPluginId),
  getContext: () =>
    extensionInvoke(ExtensionPluginIpcChannels.getContext) as Promise<
      ExtensionContextPayload
    >,
  close: () => extensionInvoke(ExtensionPluginIpcChannels.closeWindow),
  invoke: (method: string, payload?: unknown) =>
    extensionInvoke(ExtensionPluginIpcChannels.invoke, method, payload),
  listInvokeMethods: () =>
    extensionInvoke(
      ExtensionPluginIpcChannels.listInvokeMethods,
    ) as Promise<ExtensionInvokeMethodDescriptor[]>,
  onHostEvent: (
    handler: (event: ExtensionHostEventEnvelope) => void,
  ): (() => void) => {
    let disposed = false
    let listener:
      | ((
          _event: Electron.IpcRendererEvent,
          envelope: ExtensionHostEventEnvelope,
        ) => void)
      | null = null

    void ensurePermissions().then((permissions) => {
      if (disposed) return
      if (!permissions.includes("host.events")) {
        log.warn("[extension-preload] host.events permission missing")
        return
      }
      listener = (_event, envelope) => {
        handler(envelope)
      }
      ipcRenderer.on(EXTENSION_HOST_EVENT_CHANNEL, listener)
    })

    return () => {
      disposed = true
      if (listener) {
        ipcRenderer.removeListener(EXTENSION_HOST_EVENT_CHANNEL, listener)
      }
    }
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("extension", extensionApi)
  } catch (error) {
    log.error("[extension-preload] expose failed", { error })
  }
} else {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).extension = extensionApi
}

export type ExtensionApi = typeof extensionApi
