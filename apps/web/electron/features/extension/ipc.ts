import { BrowserWindow, dialog, type IpcMainInvokeEvent } from "electron"
import {
  ExtensionHostIpcChannels,
  ExtensionPluginIpcChannels,
} from "../../shared/extension-ipc-channels"
import type { AppContext } from "../../core/app-context"
import type { IpcContribution } from "../../core/ipc/types"
import { buildExtensionContext } from "./extension-context"
import { emitHostEvent } from "./extension-host-events"
import { installExtensionFromZip } from "./extension-installer"
import { uninstallExtension } from "./extension-uninstaller"
import { dispatchExtensionInvoke } from "./extension-invoke-router"
import { listExtensionInvokeMethods } from "./extension-permissions"
import {
  activateExtension,
  deactivateExtension,
  getExtensionManifest,
  listExtensions,
  scanExtensions,
} from "./extension-loader"
import {
  closeExtensionWindow,
  getExtensionIdForWebContents,
  getExtensionServiceBaseUrl,
  openExtensionWindow,
} from "./extension-window"
import { setExtensionEnabled } from "./extension-store"

function resolveExtensionIdFromEvent(
  event: IpcMainInvokeEvent,
): string | undefined {
  return getExtensionIdForWebContents(event.sender)
}

/** 拒绝插件窗调用 ext:host:* 敏感 API；主应用各窗口（main、settings 等）允许 */
function assertTrustedHostCaller(event: IpcMainInvokeEvent): void {
  const extensionId = getExtensionIdForWebContents(event.sender)
  if (extensionId) {
    throw new Error(
      "This host API cannot be invoked from an extension window",
    )
  }
}

function buildContextForExtensionId(extensionId: string) {
  const manifest = getExtensionManifest(extensionId)
  if (!manifest) {
    throw new Error(`Extension not found: ${extensionId}`)
  }
  return buildExtensionContext(manifest, {
    serviceBaseUrl: getExtensionServiceBaseUrl(extensionId),
  })
}

export const extensionIpcContribution: IpcContribution = {
  id: "extension",
  register(_ctx: AppContext) {
    return [
      {
        channel: ExtensionHostIpcChannels.list,
        handler: () => {
          scanExtensions()
          return listExtensions()
        },
      },
      {
        channel: ExtensionHostIpcChannels.open,
        handler: async (_event, extensionId: string) => {
          await openExtensionWindow(extensionId)
        },
      },
      {
        channel: ExtensionHostIpcChannels.close,
        handler: (_event, extensionId: string) => {
          closeExtensionWindow(extensionId)
        },
      },
      {
        channel: ExtensionHostIpcChannels.setEnabled,
        handler: async (_event, extensionId: string, enabled: boolean) => {
          if (!getExtensionManifest(extensionId)) {
            throw new Error(`Extension not found: ${extensionId}`)
          }
          setExtensionEnabled(extensionId, enabled)
          if (enabled) {
            await activateExtension(extensionId)
          } else {
            deactivateExtension(extensionId)
          }
        },
      },
      {
        channel: ExtensionHostIpcChannels.getContext,
        handler: (event, extensionId: string) => {
          assertTrustedHostCaller(event)
          return buildContextForExtensionId(extensionId)
        },
      },
      {
        channel: ExtensionHostIpcChannels.emitEvent,
        handler: (_event, type: string, payload?: unknown) => {
          emitHostEvent(type, payload)
        },
      },
      {
        channel: ExtensionHostIpcChannels.installFromZip,
        handler: async (event) => {
          assertTrustedHostCaller(event)
          const parent = BrowserWindow.fromWebContents(event.sender)
          if (!parent || parent.isDestroyed()) {
            throw new Error("No host window available for file dialog")
          }
          const result = await dialog.showOpenDialog(parent, {
            title: "安装插件",
            filters: [{ name: "Extension Zip", extensions: ["zip"] }],
            properties: ["openFile"],
          })
          if (result.canceled || result.filePaths.length === 0) {
            throw new Error("Install cancelled")
          }
          return installExtensionFromZip(result.filePaths[0]!)
        },
      },
      {
        channel: ExtensionHostIpcChannels.uninstall,
        handler: async (event, extensionId: string) => {
          assertTrustedHostCaller(event)
          await uninstallExtension(extensionId)
        },
      },
      {
        channel: ExtensionPluginIpcChannels.getPluginId,
        handler: (event) => {
          const id = resolveExtensionIdFromEvent(event)
          if (!id) throw new Error("Not an extension window")
          return id
        },
      },
      {
        channel: ExtensionPluginIpcChannels.getContext,
        handler: (event) => {
          const id = resolveExtensionIdFromEvent(event)
          if (!id) throw new Error("Not an extension window")
          return buildContextForExtensionId(id)
        },
      },
      {
        channel: ExtensionPluginIpcChannels.closeWindow,
        handler: (event) => {
          const win = BrowserWindow.fromWebContents(event.sender)
          if (win && !win.isDestroyed()) {
            win.close()
            return
          }
          const id = resolveExtensionIdFromEvent(event)
          if (id) closeExtensionWindow(id)
        },
      },
      {
        channel: ExtensionPluginIpcChannels.invoke,
        handler: async (event, method: string, payload?: unknown) => {
          const id = resolveExtensionIdFromEvent(event)
          if (!id) throw new Error("Not an extension window")
          const manifest = getExtensionManifest(id)
          if (!manifest) throw new Error(`Extension not found: ${id}`)
          return dispatchExtensionInvoke(id, manifest, method, payload)
        },
      },
      {
        channel: ExtensionPluginIpcChannels.listInvokeMethods,
        handler: (event) => {
          const id = resolveExtensionIdFromEvent(event)
          if (!id) throw new Error("Not an extension window")
          const manifest = getExtensionManifest(id)
          if (!manifest) throw new Error(`Extension not found: ${id}`)
          return listExtensionInvokeMethods(manifest)
        },
      },
    ]
  },
}
