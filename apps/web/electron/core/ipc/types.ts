import type { IpcMainInvokeEvent } from "electron"
import type { AppContext } from "../app-context"

/** IPC invoke 参数在运行时由 preload 传入，具体 channel 的类型在各 feature 内收窄 */
export type IpcHandler = (
  event: IpcMainInvokeEvent,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 允许各 feature 为 args 声明更窄的类型
  ...args: any[]
) => unknown

export interface IpcHandlerRegistration {
  channel: string
  handler: IpcHandler
}

export interface IpcContribution {
  readonly id: string
  register(ctx: AppContext): IpcHandlerRegistration[]
}
