import { contextBridge, ipcRenderer } from "electron"
import log from "electron-log/preload"
import {
  ExtensionPluginIpcChannels,
  type ExtensionContextPayload,
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
