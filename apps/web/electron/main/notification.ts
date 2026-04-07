import { BrowserWindow, Notification } from "electron"

/**
 * 系统通知管理
 *
 * 负责：
 * - 发送 OS 原生通知（屏幕右下角 Toast 弹窗）
 * - 点击通知时显示/聚焦主窗口（从托盘唤出）
 *
 * 特性：
 * - 最小化到托盘时也能看到通知
 * - 支持静默模式（不播放系统提示音）
 * - 点击通知自动聚焦窗口
 */

/**
 * 发送系统通知
 *
 * @param options.title - 通知标题
 * @param options.body - 通知正文
 * @param options.silent - 是否静默（默认 false，播放系统提示音）
 * @param options.win - 主窗口引用，用于点击通知时聚焦
 */
export function sendNotification(options: {
  title: string
  body: string
  silent?: boolean
  win: BrowserWindow
}): void {
  const notification = new Notification({
    title: options.title,
    body: options.body,
    silent: options.silent ?? false,
    icon: process.env.VITE_PUBLIC
      ? `${process.env.VITE_PUBLIC}/logo.svg`
      : undefined,
  })

  // 点击通知 → 显示并聚焦主窗口
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
