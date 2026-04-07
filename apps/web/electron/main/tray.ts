import { app, BrowserWindow, Menu, Tray, nativeImage } from "electron"
import path from "node:path"
import { setForceQuit, stopBackend } from "./ipc-handlers"

/**
 * 系统托盘管理
 *
 * 负责：
 * - 创建系统托盘图标和右键菜单
 * - 双击托盘图标显示/聚焦主窗口
 * - 右键菜单提供「显示窗口」和「退出」
 * - 托盘闪烁通知（模拟微信/QQ 新消息提醒）
 * - 退出时清理托盘资源
 *
 * 依赖：
 * - ipc-handlers.ts: setForceQuit / stopBackend（退出流程）
 */

let tray: Tray | null = null
let normalIcon: Electron.NativeImage | null = null
let notifyIcon: Electron.NativeImage | null = null
let flashTimer: ReturnType<typeof setInterval> | null = null

/**
 * 生成带红点角标的通知图标
 *
 * 原理：在原图右下角叠加一个红色小圆点，
 * 使用 nativeImage 的 resize + createFromBuffer 纯代码实现，无需额外素材。
 *
 * 由于 Electron nativeImage API 不支持像素级绘制，
 * 这里采用「创建独立红点图像 → 叠加到原图」的方式：
 * 1. 将原图缩放到 16x16 作为底图
 * 2. 创建一个 4x4 的红色圆点图像
 * 3. 将两者合成为新的通知图标
 */
function generateNotifyIcon(base: Electron.NativeImage): Electron.NativeImage {
  // 缩放底图到 16x16（托盘标准尺寸）
  const size = { width: 16, height: 16 }
  const resized = base.resize(size)

  // 红点：4x4 RGBA，半透明红色圆点
  // 4x4 像素矩阵，模拟圆形：中间 4 像素为红色，四角透明
  const dotSize = 4
  const dotBuffer = Buffer.from([
    0, 0, 0, 0,         // 左上 透明
    0, 0, 0, 0,         // 右上 透明
    0, 0, 0, 0,         // 左上 透明
    255, 66, 66, 255,   // 红色
  ])
  const dot = nativeImage.createFromBuffer(dotBuffer, {
    width: dotSize,
    height: dotSize,
  })

  // 将红点叠加到原图右下角（偏移 12,12）
  // Electron 不提供原生图像合成，采用简单方案：
  // 创建一个 16x16 画布，用 fromBuffer + toBitmap 方式
  // 由于 API 限制，直接用原图作为通知图标，改为在托盘旁显示未读计数
  // 实际实现：创建一个带红色边框的 16x16 图标来替代
  const borderSize = 2
  const canvasSize = size.width + borderSize * 2
  const canvasBuffer = Buffer.alloc(canvasSize * canvasSize * 4)

  // 填充红色边框背景
  for (let i = 0; i < canvasSize * canvasSize; i++) {
    canvasBuffer[i * 4] = 255       // R
    canvasBuffer[i * 4 + 1] = 66    // G
    canvasBuffer[i * 4 + 2] = 66    // B
    canvasBuffer[i * 4 + 3] = 255   // A
  }

  // 将底图绘制到画布中心
  const sourceBitmap = resized.toBitmap()
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const srcIdx = (y * size.width + x) * 4
      // BGRA → RGBA（nativeImage toBitmap 返回 BGRA 格式）
      const r = sourceBitmap[srcIdx + 2]
      const g = sourceBitmap[srcIdx + 1]
      const b = sourceBitmap[srcIdx]
      const a = sourceBitmap[srcIdx + 3]

      const dstX = x + borderSize
      const dstY = y + borderSize
      const dstIdx = (dstY * canvasSize + dstX) * 4
      canvasBuffer[dstIdx] = r
      canvasBuffer[dstIdx + 1] = g
      canvasBuffer[dstIdx + 2] = b
      canvasBuffer[dstIdx + 3] = a
    }
  }

  return nativeImage.createFromBuffer(canvasBuffer, {
    width: canvasSize,
    height: canvasSize,
  })
}

/**
 * 加载图标文件
 *
 * 优先使用 .ico（Windows 原生支持），回退 .png。
 * 空路径或加载失败时不会崩溃，返回空图像。
 */
function loadIcon(): Electron.NativeImage {
  const icoPath = path.join(process.env.APP_ROOT!, "build/icon.ico")
  const pngPath = path.join(process.env.APP_ROOT!, "build/icon.png")

  try {
    const image = nativeImage.createFromPath(icoPath)
    if (!image.isEmpty()) return image
  } catch {
    // .ico 加载失败，尝试 .png
  }

  return nativeImage.createFromPath(pngPath)
}

/**
 * 创建系统托盘
 *
 * 图标路径优先使用 .ico（Windows），否则回退到 .png。
 * 同时预生成通知图标，并监听窗口聚焦事件自动停止闪烁。
 */
export function createTray(win: BrowserWindow): void {
  if (tray) return

  normalIcon = loadIcon()
  notifyIcon = generateNotifyIcon(normalIcon)

  tray = new Tray(normalIcon)
  tray.setToolTip("DigitalEmployee")

  // 右键上下文菜单
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "显示窗口",
      click: () => showWindow(win),
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => quitFromTray(win),
    },
  ])

  tray.setContextMenu(contextMenu)

  // 双击托盘图标 → 显示窗口
  tray.on("double-click", () => {
    showWindow(win)
  })

  // 窗口聚焦时自动停止闪烁（用户已看到消息）
  win.on("focus", () => {
    stopFlashTray()
  })
}

/**
 * 显示并聚焦主窗口
 *
 * 如果窗口被最小化则先还原，再显示并聚焦。
 */
function showWindow(win: BrowserWindow): void {
  if (win.isMinimized()) {
    win.restore()
  }
  win.show()
  win.focus()
}

/**
 * 开始托盘闪烁
 *
 * 每 500ms 交替切换正常图标和通知图标，
 * 模拟微信/QQ 新消息提醒效果。
 * 如果已在闪烁中，不会重复启动定时器。
 */
export function flashTray(): void {
  if (!tray || flashTimer) return

  let showNotify = true
  flashTimer = setInterval(() => {
    if (!tray || tray.isDestroyed()) {
      stopFlashTray()
      return
    }
    tray.setImage(showNotify ? notifyIcon! : normalIcon!)
    showNotify = !showNotify
  }, 500)
}

/**
 * 停止托盘闪烁
 *
 * 清除定时器，恢复正常图标。
 */
export function stopFlashTray(): void {
  if (flashTimer) {
    clearInterval(flashTimer)
    flashTimer = null
  }
  // 恢复正常图标
  if (tray && !tray.isDestroyed() && normalIcon) {
    tray.setImage(normalIcon)
  }
}

/**
 * 从托盘菜单退出应用
 *
 * 流程：
 * 1. 设置 forceQuit 标志（允许窗口真正关闭）
 * 2. 先停止闪烁、销毁托盘，防止退出过程中残留
 * 3. 停止后端进程
 * 4. 关闭窗口，触发 app.quit
 */
function quitFromTray(win: BrowserWindow): void {
  setForceQuit(true)
  stopFlashTray()
  destroyTray()
  stopBackend()
  win.close()

  // 兜底超时，确保应用能退出
  setTimeout(() => {
    app.exit(0)
  }, 3000).unref()
}

/**
 * 销毁系统托盘
 *
 * 在应用退出前调用，清理闪烁定时器和托盘图标资源。
 */
export function destroyTray(): void {
  stopFlashTray()
  if (tray) {
    tray.destroy()
    tray = null
  }
  normalIcon = null
  notifyIcon = null
}
