import { ipcRenderer } from "electron"

export function invoke<T = unknown>(
  channel: string,
  ...args: unknown[]
): Promise<T> {
  return ipcRenderer.invoke(channel, ...args)
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
