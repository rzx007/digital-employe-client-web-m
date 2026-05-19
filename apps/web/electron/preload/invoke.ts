import { ipcRenderer } from "electron"
import type { IpcChannel, IpcResult } from "../shared/ipc-channels"

export function invoke<C extends IpcChannel>(
  channel: C,
  ...args: unknown[]
): Promise<IpcResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<C>>
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
