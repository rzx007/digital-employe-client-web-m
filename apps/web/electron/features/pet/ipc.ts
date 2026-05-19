import { hidePetWindow, getPetWin } from "../../main/pet"
import { IpcChannels } from "../../shared/ipc-channels"
import type { AppContext } from "../../core/app-context"
import type { IpcContribution } from "../../core/ipc/types"

const PET_WINDOW_WIDTH = 230
const PET_WINDOW_HEIGHT = 260

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
    ]
  },
}
