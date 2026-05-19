import type { BrowserWindow } from "electron"

export type WindowId =
  | "main"
  | "login"
  | "settings"
  | "recruitment"
  | "register"
  | "pet"
  | "splash"

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
}
