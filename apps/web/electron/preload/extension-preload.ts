import { contextBridge, ipcRenderer } from "electron"
import log from "electron-log/preload"
import {
  ExtensionIpcChannels,
  type ExtensionContextPayload,
  type ExtensionIpcChannel,
  type ExtensionIpcResult,
} from "../shared/extension-ipc-channels"

function extensionInvoke<C extends ExtensionIpcChannel>(
  channel: C,
  ...args: unknown[]
): Promise<ExtensionIpcResult<C>> {
  return ipcRenderer
    .invoke(channel, ...args)
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      log.warn(`[extension-preload:invoke] ${channel} failed`, {
        channel,
        message,
      })
      throw err
    }) as Promise<ExtensionIpcResult<C>>
}

const extensionApi = {
  apiVersion: 1 as const,
  getPluginId: () => extensionInvoke(ExtensionIpcChannels.getPluginId),
  getContext: () =>
    extensionInvoke(ExtensionIpcChannels.getContext) as Promise<
      ExtensionContextPayload
    >,
  close: () => extensionInvoke(ExtensionIpcChannels.closeWindow),
  invoke: (method: string, payload?: unknown) =>
    extensionInvoke(ExtensionIpcChannels.invoke, method, payload),
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
