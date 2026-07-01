import { ipcMain } from "electron"
import type { AppContext } from "../app-context"
import { createLogger } from "../logger"
import type { IpcContribution } from "./types"
import { wrapIpcHandler } from "./wrap-handler"

const registryLogger = createLogger("IpcRegistry")

/**
 * 集中注册 IPC handlers，防止重复注册与散落 ipcMain.handle
 */
export class IpcRegistry {
  private readonly registered = new Map<string, string>()

  constructor(private readonly ctx: AppContext) {}

  register(contribution: IpcContribution): void {
    for (const { channel, handler } of contribution.register(this.ctx)) {
      if (this.registered.has(channel)) {
        registryLogger.warn(
          `channel "${channel}" already registered by ${this.registered.get(channel)}, skipping duplicate from ${contribution.id}`,
        )
        continue
      }
      ipcMain.handle(
        channel,
        wrapIpcHandler(contribution.id, channel, handler),
      )
      this.registered.set(channel, contribution.id)
    }
  }

  dispose(contributionId?: string): void {
    for (const [channel, owner] of this.registered) {
      if (contributionId && owner !== contributionId) continue
      ipcMain.removeHandler(channel)
      this.registered.delete(channel)
    }
  }
}
