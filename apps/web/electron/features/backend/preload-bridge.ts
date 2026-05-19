import { IpcChannels } from "../../shared/ipc-channels"
import { invoke, onChannelAll } from "../../preload/invoke"

export const backendBridge = {
  getBackendStatus: () => invoke(IpcChannels.getBackendStatus),
  getBackendPort: () => invoke(IpcChannels.getBackendPort),
  onBackendError: (callback: (message: string) => void) =>
    onChannelAll("backend-error", (message) =>
      callback(message as string),
    ),
  onBackendPort: (callback: (port: number) => void) =>
    onChannelAll("backend-port", (port) => callback(port as number)),
}
