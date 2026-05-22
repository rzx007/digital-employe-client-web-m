import { BrowserWindow, Notification } from "electron"

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

  const notification = new Notification({
    title: options.title,
    body: options.body,
    silent: options.silent ?? false,
    icon: process.env.VITE_PUBLIC
      ? `${process.env.VITE_PUBLIC}/logo.png`
      : undefined,
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
