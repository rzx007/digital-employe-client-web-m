/**
 * 插件体系 IPC — 与主应用 IpcChannels 分离
 * - ext:host:*  主应用 SPA（electronApi 管理插件）
 * - ext:plugin:* 插件窗口（window.extension）
 */

/** 宿主：设置页等 */
export const ExtensionHostIpcChannels = {
  list: "ext:host:list",
  open: "ext:host:open",
  close: "ext:host:close",
  setEnabled: "ext:host:set-enabled",
  getContext: "ext:host:get-context",
  emitEvent: "ext:host:emit-event",
} as const

/** 插件窗：extension-preload */
export const ExtensionPluginIpcChannels = {
  getPluginId: "ext:plugin:get-plugin-id",
  getContext: "ext:plugin:get-context",
  closeWindow: "ext:plugin:close-window",
  invoke: "ext:plugin:invoke",
} as const

/** 主进程 → 插件窗 push（非 invoke） */
export const EXTENSION_HOST_EVENT_CHANNEL = "ext:host:event"

export type ExtensionHostIpcChannel =
  (typeof ExtensionHostIpcChannels)[keyof typeof ExtensionHostIpcChannels]

export type ExtensionPluginIpcChannel =
  (typeof ExtensionPluginIpcChannels)[keyof typeof ExtensionPluginIpcChannels]

export interface ExtensionListItem {
  id: string
  version: string
  displayName: string
  hasUi: boolean
  /** manifest 含 service 块 */
  hasService: boolean
  serviceRunning: boolean
  enabled: boolean
}

export interface ExtensionContextPayload {
  pluginId: string
  displayName: string
  version: string
  hostVersion: string
  permissions: string[]
  authToken?: string
  /** 含 service 块且本地服务已启动时 */
  serviceBaseUrl?: string
}

export interface ExtensionHostEventEnvelope {
  type: string
  payload?: unknown
  timestamp: number
}

/**
 * extension.invoke 方法（需在 manifest permissions 中声明对应项）
 * - notification.show → host.notification
 * - window.focusMain → host.window.main
 * - storage.get / storage.set → host.storage
 * - backend.getPort → host.backend.read
 */
export type ExtensionInvokeMethod =
  | "notification.show"
  | "window.focusMain"
  | "storage.get"
  | "storage.set"
  | "backend.getPort"

export interface ExtensionHostInvokeMap {
  [ExtensionHostIpcChannels.list]: { args: []; result: ExtensionListItem[] }
  [ExtensionHostIpcChannels.open]: { args: [extensionId: string]; result: void }
  [ExtensionHostIpcChannels.close]: { args: [extensionId: string]; result: void }
  [ExtensionHostIpcChannels.setEnabled]: {
    args: [extensionId: string, enabled: boolean]
    result: void
  }
  [ExtensionHostIpcChannels.getContext]: {
    args: [extensionId: string]
    result: ExtensionContextPayload
  }
  [ExtensionHostIpcChannels.emitEvent]: {
    args: [type: string, payload?: unknown]
    result: void
  }
}

export interface ExtensionPluginInvokeMap {
  [ExtensionPluginIpcChannels.getPluginId]: { args: []; result: string }
  [ExtensionPluginIpcChannels.getContext]: {
    args: []
    result: ExtensionContextPayload
  }
  [ExtensionPluginIpcChannels.closeWindow]: { args: []; result: void }
  [ExtensionPluginIpcChannels.invoke]: {
    args: [method: string, payload?: unknown]
    result: unknown
  }
}

export type ExtensionHostIpcResult<C extends ExtensionHostIpcChannel> =
  ExtensionHostInvokeMap[C]["result"]

export type ExtensionPluginIpcResult<C extends ExtensionPluginIpcChannel> =
  ExtensionPluginInvokeMap[C]["result"]
