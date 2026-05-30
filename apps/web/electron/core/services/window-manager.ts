import { BrowserWindow, type BrowserWindowConstructorOptions } from "electron"
import {
  getPreloadPath,
  getAppIconPath,
  buildHashRouteUrl,
} from "../runtime-paths"

export type BuiltinWindowId =
  | "main"
  | "login"
  | "activation"
  | "settings"
  | "recruitment"
  | "register"
  | "pet"
  | "splash"

export type WindowId = BuiltinWindowId | `plugin:${string}`

export function pluginWindowId(extensionId: string): `plugin:${string}` {
  return `plugin:${extensionId}`
}

export function isPluginWindowId(id: WindowId): id is `plugin:${string}` {
  return id.startsWith("plugin:")
}

export interface WindowDescriptor {
  id: WindowId
  /** 主应用 SPA hash 路由 */
  route?: string
  /** 插件或独立页面：本地 HTML 文件绝对路径 */
  loadFile?: string
  /** 插件开发态或远程页面 URL */
  loadUrl?: string
  /** 默认主应用 preload；插件窗应传 extension preload */
  preloadPath?: string
  overrides: BrowserWindowConstructorOptions
  onCreated?: (win: BrowserWindow) => void
}

/**
 * 统一管理各 BrowserWindow 引用
 */
export class WindowManager {
  private readonly windows = new Map<WindowId, BrowserWindow>()

  set(id: WindowId, win: BrowserWindow | null): void {
    if (win === null) {
      this.windows.delete(id)
      return
    }
    this.windows.set(id, win)
  }

  get(id: WindowId): BrowserWindow | null {
    const win = this.windows.get(id)
    if (!win || win.isDestroyed()) {
      this.windows.delete(id)
      return null
    }
    return win
  }

  getMain(): BrowserWindow | null {
    return this.get("main")
  }

  focus(id: WindowId): BrowserWindow | null {
    const win = this.get(id)
    if (win) win.focus()
    return win
  }

  close(id: WindowId): void {
    const win = this.get(id)
    if (!win) return
    win.close()
    this.set(id, null)
  }

  /**
   * 工厂方法：创建 BrowserWindow，自动注册到 WindowManager，
   * 统一 preload / icon / URL 加载 / closed 清理。
   */
  createWindow(descriptor: WindowDescriptor): BrowserWindow {
    const {
      id,
      route,
      loadFile,
      loadUrl,
      preloadPath,
      overrides,
      onCreated,
    } = descriptor

    const loadTargets = [route, loadFile, loadUrl].filter(Boolean)
    if (loadTargets.length !== 1) {
      throw new Error(
        `[WindowManager] exactly one of route, loadFile, loadUrl is required`,
      )
    }

    const defaults: BrowserWindowConstructorOptions = {
      icon: getAppIconPath(),
      webPreferences: {
        preload: preloadPath ?? getPreloadPath(),
        nodeIntegration: false,
        contextIsolation: true,
      },
    }

    const win = new BrowserWindow({
      ...defaults,
      ...overrides,
      webPreferences: {
        ...defaults.webPreferences,
        ...overrides.webPreferences,
      },
    })

    if (loadUrl) {
      void win.loadURL(loadUrl)
    } else if (loadFile) {
      void win.loadFile(loadFile)
    } else if (route) {
      void win.loadURL(buildHashRouteUrl(route))
    }

    win.on("closed", () => {
      this.set(id, null)
    })

    this.set(id, win)
    onCreated?.(win)

    return win
  }
}
