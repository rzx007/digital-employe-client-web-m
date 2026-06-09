import { BrowserWindow, dialog } from "electron"
import { hidePetWindow, getPetWin } from "./pet-window"
import { PET_WINDOW_HEIGHT, PET_WINDOW_WIDTH } from "./pet-window-size"
import { installPetFromZip } from "./pet-installer"
import {
  getCustomPetMeta,
  listCustomPets,
  uninstallPet,
} from "./pet-registry"
import {
  getSetting,
  setSetting,
} from "../settings/settings-store"
import { IpcChannels } from "../../shared/ipc-channels"
import type { AppContext } from "../../core/app-context"
import type { IpcContribution } from "../../core/ipc/types"

export const petIpcContribution: IpcContribution = {
  id: "pet",
  register(ctx: AppContext) {
    return [
      {
        channel: IpcChannels.petShow,
        handler: () => {
          hidePetWindow()
          const main = ctx.windowManager.getMain()
          if (main && !main.isDestroyed()) {
            if (main.isMinimized()) main.restore()
            main.show()
            main.focus()
          } else {
            // 主窗已关闭/销毁（只剩宠物时）：重建主窗，否则点宠物没有任何反应
            void ctx.createMainWindow()
          }
        },
      },
      {
        channel: IpcChannels.petHide,
        handler: () => hidePetWindow(),
      },
      {
        channel: IpcChannels.petSetPosition,
        handler: (_event, x: unknown, y: unknown) => {
          const petWin = getPetWin()
          if (!petWin || petWin.isDestroyed()) return
          petWin.setBounds(
            {
              x: Math.round(Number(x)),
              y: Math.round(Number(y)),
              width: PET_WINDOW_WIDTH,
              height: PET_WINDOW_HEIGHT,
            },
            false,
          )
        },
      },
      {
        channel: IpcChannels.petGetPosition,
        handler: () => {
          const petWin = getPetWin()
          if (!petWin || petWin.isDestroyed()) return null
          const [px, py] = petWin.getPosition()
          return { x: px, y: py }
        },
      },
      {
        channel: IpcChannels.petGetSelected,
        handler: () => getSetting("selectedPetSlug"),
      },
      {
        channel: IpcChannels.petSelect,
        handler: (_event, slug: unknown) => {
          setSetting("selectedPetSlug", String(slug))
          getPetWin()?.webContents.send("pet-changed", slug)
        },
      },
      {
        channel: IpcChannels.petListPetdex,
        handler: async () => listCustomPets(),
      },
      {
        channel: IpcChannels.petGetPetdexMeta,
        handler: async (_event, slug: unknown) =>
          getCustomPetMeta(String(slug)),
      },
      {
        channel: IpcChannels.petInstallFromZip,
        handler: async (event) => {
          const parent = BrowserWindow.fromWebContents(event.sender)
          if (!parent || parent.isDestroyed()) {
            throw new Error("No host window available for file dialog")
          }
          const result = await dialog.showOpenDialog(parent, {
            title: "安装宠物",
            filters: [{ name: "Pet Zip", extensions: ["zip"] }],
            properties: ["openFile"],
          })
          if (result.canceled || result.filePaths.length === 0) {
            return null
          }
          return installPetFromZip(result.filePaths[0]!)
        },
      },
      {
        channel: IpcChannels.petUninstall,
        handler: async (_event, slug: unknown) => {
          uninstallPet(String(slug))
        },
      },
    ]
  },
}
