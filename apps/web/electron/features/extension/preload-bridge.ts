import { IpcChannels } from "../../shared/ipc-channels"
import { invoke } from "../../preload/invoke"

export interface ExtensionListItem {
  id: string
  version: string
  displayName: string
  kind: string
  enabled: boolean
}

export const extensionBridge = {
  listExtensions: () =>
    invoke(IpcChannels.extList) as Promise<ExtensionListItem[]>,
  openExtension: (extensionId: string) =>
    invoke(IpcChannels.extOpen, extensionId),
  closeExtension: (extensionId: string) =>
    invoke(IpcChannels.extClose, extensionId),
  setExtensionEnabled: (extensionId: string, enabled: boolean) =>
    invoke(IpcChannels.extSetEnabled, extensionId, enabled),
}
