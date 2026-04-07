import { app, BrowserWindow, ipcMain, shell } from "electron"
import os from "node:os"
import { getBackendStatus, getBackendPort, stopBackend } from "./backend"
import { flashTray, stopFlashTray } from "./tray"
import { sendNotification } from "./notification"
import { closeLoginWindow } from "./login"

/**
 * IPC 通信处理器
 *
 * 注册所有渲染进程与主进程之间的 IPC 通信通道。
 * 分为：
 * - 后端管理：查询后端状态、端口
 * - 窗口控制：最小化、最大化、关闭、退出
 * - 系统信息：平台检测
 * - 托盘控制：闪烁通知、停止闪烁
 * - 系统通知：发送 OS 原生通知
 * - 登录控制：登录成功跳转
 *
 * 窗口引用通过 setMainWindow() 动态更新，
 * 登录窗口创建时 win 为 null，主窗口创建后更新引用。
 */

// 主窗口引用（登录阶段为 null，主窗口创建后更新）
let mainWin: BrowserWindow | null = null
// 登录成功回调
let _onLoginSuccess: (() => void) | null = null

/**
 * 设置主窗口引用
 *
 * 在 createWindow() 创建主窗口后调用，
 * 使窗口控制类 IPC（minimize/maximize/close 等）生效。
 */
export function setMainWindow(win: BrowserWindow): void {
  mainWin = win
}

/**
 * 注册所有 IPC handlers
 *
 * 应在 app.whenReady() 中调用，登录窗口和主窗口共用。
 *
 * @param onLoginSuccess - 登录成功回调（关闭登录窗口、创建主窗口）
 */
export function registerIpcHandlers(onLoginSuccess: () => void): void {
  _onLoginSuccess = onLoginSuccess

  // ========== 后端管理 ==========

  /** 查询后端运行状态 */
  ipcMain.handle("get-backend-status", () => {
    return getBackendStatus()
  })

  /** 获取后端端口号 */
  ipcMain.handle("get-backend-port", () => {
    return getBackendPort()
  })

  // ========== 窗口控制 ==========

  /** 退出应用（同时关闭后端） */
  ipcMain.handle("quit-app", () => {
    quitApp()
  })

  /** 最小化窗口 */
  ipcMain.handle("minimize-window", () => {
    mainWin?.minimize()
  })

  /** 关闭窗口（最小化到托盘，不退出应用） */
  ipcMain.handle("close-window", () => {
    mainWin?.hide()
  })

  /** 最大化/还原窗口 */
  ipcMain.handle("maximize-window", () => {
    if (mainWin?.isMaximized()) {
      mainWin.unmaximize()
    } else {
      mainWin?.maximize()
    }
  })

  /** 查询窗口是否最大化 */
  ipcMain.handle("is-maximized", () => {
    return mainWin?.isMaximized() ?? false
  })

  /** 设置强制退出标志（用于自定义标题栏关闭按钮） */
  ipcMain.handle("set-force-quit", (_event, value: boolean) => {
    setForceQuit(value)
  })

  // ========== 系统信息 ==========

  /** 获取当前运行平台 */
  ipcMain.handle("get-platform", () => {
    return {
      isLinux: process.platform === "linux",
      isWin: process.platform === "win32",
      isMac: process.platform === "darwin",
    }
  })

  // ========== 其他 ==========

  /** 打开新窗口 */
  ipcMain.handle("open-win", (_, arg) => {
    openChildWindow(arg)
  })

  // ========== 托盘控制 ==========

  /** 开始托盘闪烁（新消息提醒） */
  ipcMain.handle("flash-tray", () => {
    flashTray()
  })

  /** 停止托盘闪烁 */
  ipcMain.handle("stop-flash-tray", () => {
    stopFlashTray()
  })

  // ========== 系统通知 ==========

  /** 发送 OS 原生通知（屏幕右下角 Toast） */
  ipcMain.handle(
    "send-notification",
    (_event, options: { title: string; body: string; silent?: boolean }) => {
      if (mainWin) {
        sendNotification({ ...options, win: mainWin })
      }
    }
  )

  // ========== 登录控制 ==========

  /** 登录成功：关闭登录窗口，触发创建主窗口 */
  ipcMain.handle("login-success", () => {
    closeLoginWindow()
    _onLoginSuccess?.()
  })
}

/**
 * 退出应用
 *
 * 1. 停止后端进程
 * 2. 给一个短超时兜底，避免后端卡住导致应用无法退出
 */
function quitApp(): void {
  setForceQuit(true)
  stopBackend()

  // 兜底超时：即使后端进程没有退出，也要确保应用能退出
  setTimeout(() => {
    app.exit(0)
  }, 3000).unref()
}

// ========== 模块内部状态 ==========

/**
 * 强制退出标志
 *
 * 防止 before-quit 事件重复触发退出逻辑。
 * 通过 getter/setter 导出，允许主进程和其他模块安全读写。
 */
let _forceQuit = false

export function isForceQuit(): boolean {
  return _forceQuit
}

export function setForceQuit(value: boolean): void {
  _forceQuit = value
}

/**
 * 打开子窗口（用于辅助页面，如新路由）
 */
function openChildWindow(arg: string): void {
  // TODO: 使用共享的 preload 路径和 indexHtml 路径
  // 目前保留原始实现，后续可提取为公共配置
}

export { stopBackend }
