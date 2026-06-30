import { BrowserWindow, Notification } from "electron"
import { resolveBrandIconPaths } from "../branding/brand-icon"

let notificationsEnabled = true

export function setNotificationsEnabled(enabled: boolean): void {
  notificationsEnabled = enabled
}

export function isNotificationsEnabled(): boolean {
  return notificationsEnabled
}

export function sendNotification(options: {
  title: string
  body: string
  silent?: boolean
  win: BrowserWindow
}): void {
  if (!notificationsEnabled) return

  const iconPath = process.env.APP_ROOT
    ? resolveBrandIconPaths(process.env.APP_ROOT).png
    : process.env.VITE_PUBLIC
      ? `${process.env.VITE_PUBLIC}/logo.png`
      : undefined

  const notification = new Notification({
    title: options.title,
    body: options.body,
    silent: options.silent ?? false,
    icon: iconPath,
  })

  notification.on("click", () => {
    const win = options.win
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) {
        win.restore()
      }
      win.show()
      win.focus()
    }
  })

  notification.show()
}
