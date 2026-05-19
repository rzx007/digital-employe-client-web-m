import { BrowserWindow, type BrowserWindowConstructorOptions } from "electron"
import { getPreloadPath, getAppIconPath, buildHashRouteUrl } from "../runtime-paths"

export type WindowId =
  | "main"
  | "login"
  | "settings"
  | "recruitment"
  | "register"
  | "pet"
  | "splash"

export interface WindowDescriptor {
  id: WindowId
  route: string
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
    const { id, route, overrides, onCreated } = descriptor

    const defaults: BrowserWindowConstructorOptions = {
      icon: getAppIconPath(),
      webPreferences: {
        preload: getPreloadPath(),
        nodeIntegration: false,
        contextIsolation: true,
      },
    }

    const win = new BrowserWindow({ ...defaults, ...overrides })

    win.loadURL(buildHashRouteUrl(route))

    win.on("closed", () => {
      this.set(id, null)
    })

    this.set(id, win)
    onCreated?.(win)

    return win
  }
}
