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

export class ElectronHostError extends Error {
  readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = "ElectronHostError"
    this.cause = cause
  }
}

export interface WithElectronApiOptions<T> {
  /** 非桌面端或调用失败时的返回值 */
  fallback?: T
  /** 失败回调（如 toast） */
  onError?: (error: unknown) => void
  /** 为 true 时不向 console 打 dev 日志 */
  silent?: boolean
}

/**
 * 在桌面端安全执行 electronApi 调用；Web 或失败时返回 fallback
 */
export async function withElectronApi<T>(
  fn: (api: ElectronApi) => T | Promise<T>,
  options?: WithElectronApiOptions<T>,
): Promise<T | undefined> {
  const api = getElectronApi()
  if (!api) return options?.fallback

  try {
    return await fn(api)
  } catch (error) {
    options?.onError?.(error)
    if (import.meta.env.DEV && !options?.silent) {
      console.error("[electron/host]", error)
    }
    return options?.fallback
  }
}

/**
 * 必须有 electronApi，否则抛出 ElectronHostError
 */
export async function requireElectronApi<T>(
  fn: (api: ElectronApi) => T | Promise<T>,
): Promise<T> {
  const api = getElectronApi()
  if (!api) {
    throw new ElectronHostError("Electron API is not available")
  }
  try {
    return await fn(api)
  } catch (error) {
    throw new ElectronHostError(
      error instanceof Error ? error.message : String(error),
      error,
    )
  }
}

/** 同步注册 IPC 事件监听（如 onRegisterSuccess），返回 cleanup */
export function subscribeElectron(
  fn: (api: ElectronApi) => (() => void) | void,
): (() => void) | undefined {
  const api = getElectronApi()
  if (!api) return undefined
  try {
    return fn(api) ?? undefined
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error("[electron/host] subscribe failed", error)
    }
    return undefined
  }
}
