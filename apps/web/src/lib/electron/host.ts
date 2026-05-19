import type { ElectronApi } from "../../../electron/preload/electron-api"

/**
 * 渲染进程访问 Electron API 的推荐入口（便于测试与后续插件注入）
 */
export function isElectron(): boolean {
  return typeof window !== "undefined" && !!window.electronApi?.isElectron
}

export function getElectronApi(): ElectronApi | undefined {
  if (!isElectron()) return undefined
  return window.electronApi
}

/** 底层 ipcRenderer（@electron-toolkit/preload），仅在需要通用 invoke 时使用 */
export function getElectronToolkit(): Window["electron"] | undefined {
  if (typeof window === "undefined" || !window.electron) return undefined
  return window.electron
}
