import { app, BrowserWindow, ipcMain, shell } from "electron"
import os from "node:os"
import path from "node:path"
import { getBackendStatus, getBackendPort, stopBackend } from "./backend"
import { flashTray, stopFlashTray } from "./tray"
import { sendNotification, setNotificationsEnabled } from "./notification"
import { closeLoginWindow, createLoginWindow } from "./login"
import { createRecruitmentWindow, closeRecruitmentWindow } from "./recruitment"
import { createSettingsWindow, closeSettingsWindow } from "./settings"
import { VITE_DEV_SERVER_URL, indexHtml } from "./index"
import {
  saveAuth,
  clearAuth,
  getStoredAuth,
  hasToken,
} from "./auth"
import { setAutoLaunch, getAutoLaunch } from "./auto-launch"
import {
  getSetting,
  setSetting,
  getModelSettings,
  setModelSettings,
  clearSettingsStore,
} from "./settings-store"

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
 * - 认证管理：保存/清除/查询认证信息
 * - 招聘窗口：打开/关闭招聘员工窗口
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

  /** 发送 OS 原生通知（仅在窗口不在焦点时发送） */
  ipcMain.handle(
    "send-notification",
    (_event, options: { title: string; body: string; silent?: boolean }) => {
      if (!mainWin || mainWin.isDestroyed()) return
      const isFocused = mainWin.isFocused() && !mainWin.isMinimized()
      if (!isFocused) {
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

  // ========== 认证管理 ==========

  /** 保存认证信息（登录成功后调用） */
  ipcMain.handle(
    "save-auth",
    (
      _event,
      data: {
        token: string
        user: Record<string, unknown>
        rememberMe: boolean
      }
    ) => {
      saveAuth(data.token, data.user, data.rememberMe)
    }
  )

  /** 清除认证信息（退出登录时调用） */
  ipcMain.handle("clear-auth", () => {
    clearAuth()

    // Electron 环境下：关闭所有窗口，打开登录窗口
    // 关闭设置窗口
    closeSettingsWindow()
    // 关闭招聘窗口
    closeRecruitmentWindow()
    // 关闭主窗口
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.close()
      mainWin = null
    }

    createLoginWindow({
      devServerUrl: VITE_DEV_SERVER_URL,
      indexHtml,
    })
  })

  /** 获取已存储的认证状态 */
  ipcMain.handle("get-auth-status", () => {
    return getStoredAuth()
  })

  /** 检查是否有持久化的 token（启动时判断是否跳过登录） */
  ipcMain.handle("has-saved-auth", () => {
    return hasToken()
  })

  // ========== 招聘窗口 ==========

  /** 打开招聘员工窗口 */
  ipcMain.handle("open-recruitment", () => {
    createRecruitmentWindow()
  })

  /** 关闭招聘员工窗口 */
  ipcMain.handle("close-recruitment", () => {
    closeRecruitmentWindow()
  })

  // ========== 设置窗口 ==========

  /** 打开设置窗口 */
  ipcMain.handle("open-settings", () => {
    createSettingsWindow()
  })

  /** 关闭设置窗口 */
  ipcMain.handle("close-settings", () => {
    closeSettingsWindow()
  })

  // ========== 应用设置 ==========

  /** 设置开机自启 */
  ipcMain.handle("set-auto-launch", (_event, enabled: boolean) => {
    setAutoLaunch(enabled)
  })

  /** 获取开机自启状态 */
  ipcMain.handle("get-auto-launch", () => {
    return getAutoLaunch()
  })

  /** 设置消息通知开关 */
  ipcMain.handle("set-notifications", (_event, enabled: boolean) => {
    setSetting("notifications", enabled)
    setNotificationsEnabled(enabled)
  })

  /** 获取消息通知开关状态 */
  ipcMain.handle("get-notifications", () => {
    return getSetting("notifications") ?? true
  })

  /** 设置自动检查更新 */
  ipcMain.handle("set-auto-update", (_event, enabled: boolean) => {
    setSetting("autoUpdate", enabled)
  })

  /** 获取自动检查更新状态 */
  ipcMain.handle("get-auto-update", () => {
    return getSetting("autoUpdate") ?? true
  })

  /** 获取模型设置 */
  ipcMain.handle("get-model-settings", () => {
    return getModelSettings()
  })

  /** 保存模型设置 */
  ipcMain.handle(
    "set-model-settings",
    (
      _event,
      data: { model: string; apiKey: string; apiUrl: string }
    ) => {
      setModelSettings(data)
    }
  )

  /** 重置应用：清除所有存储数据并重启 */
  ipcMain.handle("reset-app", () => {
    clearAuth()
    clearSettingsStore()
    app.relaunch({ args: process.argv.slice(1).concat(["--relaunched"]) })
    app.exit(0)
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
