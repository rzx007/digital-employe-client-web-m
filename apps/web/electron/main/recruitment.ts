import { BrowserWindow } from "electron"
import path from "node:path"

/**
 * 招聘窗口管理
 *
 * 负责：
 * - 创建招聘窗口（与主窗口一致）
 * - 加载应用内 /#/recruitment 路由页面
 * - 销毁招聘窗口资源
 *
 * 窗口配置与主窗口一致：1024x768、有标题栏、可调整大小
 */

let recruitmentWin: BrowserWindow | null = null

/**
 * 创建招聘窗口
 */
export function createRecruitmentWindow(): void {
  if (recruitmentWin) {
    recruitmentWin.focus()
    return
  }

  const preload = path.join(
    process.env.APP_ROOT!,
    "dist-electron/preload/index.mjs"
  )

  recruitmentWin = new BrowserWindow({
    width: 1024,
    height: 768,
    minWidth: 1024,
    minHeight: 768,
    title: "招聘员工",
    icon: path.join(process.env.APP_ROOT!, "build/icon.ico"),
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
  const RENDERER_DIST = path.join(process.env.APP_ROOT!, "dist")
  const indexHtml = path.join(RENDERER_DIST, "index.html")

  if (VITE_DEV_SERVER_URL) {
    recruitmentWin.loadURL(`${VITE_DEV_SERVER_URL}#/recruitment`)
    recruitmentWin.webContents.openDevTools()
  } else {
    recruitmentWin.loadFile(`${indexHtml}#/recruitment`)
  }
  recruitmentWin.on("closed", () => {
    recruitmentWin = null
  })
}

/**
 * 关闭招聘窗口
 */
export function closeRecruitmentWindow(): void {
  if (!recruitmentWin || recruitmentWin.isDestroyed()) return
  recruitmentWin.close()
  recruitmentWin = null
}