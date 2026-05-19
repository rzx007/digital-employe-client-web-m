import { Menu } from "electron"

import { APP_DISPLAY_NAME } from "./app-product"
import { checkForUpdatesFromMenu } from "../features/update/auto-updater"

/**
 * macOS 应用菜单（苹果图标旁第一项 + 编辑 / 显示 / 窗口）
 *
 * 开发环境下第一项仍可能显示为 Electron，但子菜单与快捷键符合系统习惯；
 * 打包后以 Info.plist / productName 为准。
 */
export function createMacApplicationMenu(): Menu {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: APP_DISPLAY_NAME,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "检查更新…",
          click: () => {
            void checkForUpdatesFromMenu()
          },
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        {
          label: `退出 ${APP_DISPLAY_NAME}`,
          accelerator: "Command+Q",
          click: () => {
            void import("../core/services/lifecycle").then(({ quitApp }) => {
              quitApp()
            })
          },
        },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    {
      label: "显示",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
      ],
    },
  ]

  return Menu.buildFromTemplate(template)
}
