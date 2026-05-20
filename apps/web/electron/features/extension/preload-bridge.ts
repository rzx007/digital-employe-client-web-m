import { ipcRenderer } from "electron"
import {
  ExtensionHostIpcChannels,
  type ExtensionContextPayload,
  type ExtensionHostIpcChannel,
  type ExtensionHostIpcResult,
  type ExtensionListItem,
} from "../../shared/extension-ipc-channels"

function invokeExtensionHost<C extends ExtensionHostIpcChannel>(
  channel: C,
  ...args: unknown[]
): Promise<ExtensionHostIpcResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<
    ExtensionHostIpcResult<C>
  >
}

export type { ExtensionListItem, ExtensionContextPayload }

export const extensionBridge = {
  listExtensions: () => invokeExtensionHost(ExtensionHostIpcChannels.list),
  openExtension: (extensionId: string) =>
    invokeExtensionHost(ExtensionHostIpcChannels.open, extensionId),
  closeExtension: (extensionId: string) =>
    invokeExtensionHost(ExtensionHostIpcChannels.close, extensionId),
  setExtensionEnabled: (extensionId: string, enabled: boolean) =>
    invokeExtensionHost(
      ExtensionHostIpcChannels.setEnabled,
      extensionId,
      enabled,
    ),
  getExtensionContext: (extensionId: string) =>
    invokeExtensionHost(
      ExtensionHostIpcChannels.getContext,
      extensionId,
    ) as Promise<ExtensionContextPayload>,
  emitExtensionHostEvent: (type: string, payload?: unknown) =>
    invokeExtensionHost(ExtensionHostIpcChannels.emitEvent, type, payload),
  installExtensionFromZip: () =>
    invokeExtensionHost(ExtensionHostIpcChannels.installFromZip),
  uninstallExtension: (extensionId: string) =>
    invokeExtensionHost(ExtensionHostIpcChannels.uninstall, extensionId),
}
