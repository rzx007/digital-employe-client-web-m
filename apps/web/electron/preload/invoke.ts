import { ipcRenderer } from "electron"
import log from "electron-log/preload"
import type { IpcChannel, IpcResult } from "../shared/ipc-channels"

export function invoke<C extends IpcChannel>(
  channel: C,
  ...args: unknown[]
): Promise<IpcResult<C>> {
  return ipcRenderer
    .invoke(channel, ...args)
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      log.warn(`[preload:invoke] ${channel} failed`, { channel, message })
      throw err
    }) as Promise<IpcResult<C>>
}

export function onChannel(
  channel: string,
  listener: (...args: unknown[]) => void,
): () => void {
  const handler = (_event: unknown, ...args: unknown[]) => listener(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

export function onChannelAll(
  channel: string,
  listener: (...args: unknown[]) => void,
): () => void {
  ipcRenderer.on(channel, (_event, ...args) => listener(...args))
  return () => ipcRenderer.removeAllListeners(channel)
}
