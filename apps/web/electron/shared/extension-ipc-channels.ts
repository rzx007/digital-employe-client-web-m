/**
 * 插件窗口专用 IPC（extension-preload ↔ 主进程）
 * 不并入主应用 IpcInvokeMap，避免污染 ElectronApi
 */
export const ExtensionIpcChannels = {
  getPluginId: "ext:get-plugin-id",
  getContext: "ext:get-context",
  /** 插件窗关闭自身（无参）；宿主按 id 关闭用 IpcChannels.extClose */
  closeWindow: "ext:close-window",
  invoke: "ext:invoke",
} as const

export type ExtensionIpcChannel =
  (typeof ExtensionIpcChannels)[keyof typeof ExtensionIpcChannels]

export interface ExtensionContextPayload {
  pluginId: string
  displayName: string
  version: string
  hostVersion: string
  authToken?: string
}

export interface ExtensionInvokeMap {
  [ExtensionIpcChannels.getPluginId]: { args: []; result: string }
  [ExtensionIpcChannels.getContext]: {
    args: []
    result: ExtensionContextPayload
  }
  [ExtensionIpcChannels.closeWindow]: { args: []; result: void }
  [ExtensionIpcChannels.invoke]: {
    args: [method: string, payload?: unknown]
    result: unknown
  }
}

export type ExtensionIpcResult<C extends ExtensionIpcChannel> =
  ExtensionInvokeMap[C]["result"]
