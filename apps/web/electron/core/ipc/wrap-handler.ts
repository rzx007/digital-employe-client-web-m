import type { IpcMainInvokeEvent } from "electron"
import { createLogger } from "../logger"
import type { IpcHandler } from "./types"

/**
 * IPC handler 错误边界：记录日志后原样 rethrow，渲染端 invoke 仍走 Promise.reject
 */
export function wrapIpcHandler(
  contributionId: string,
  channel: string,
  handler: IpcHandler,
): IpcHandler {
  const logger = createLogger(`ipc:${contributionId}`)

  return (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      const result = handler(event, ...args)
      return Promise.resolve(result).catch((err: unknown) => {
        logHandlerError(logger, channel, err)
        throw normalizeError(err)
      })
    } catch (err) {
      logHandlerError(logger, channel, err)
      throw normalizeError(err)
    }
  }
}

function logHandlerError(
  logger: ReturnType<typeof createLogger>,
  channel: string,
  err: unknown,
): void {
  const message = err instanceof Error ? err.message : String(err)
  logger.error(`IPC handler failed: ${channel}`, {
    channel,
    message,
    stack: err instanceof Error ? err.stack : undefined,
  })
}

function normalizeError(err: unknown): Error {
  if (err instanceof Error) return err
  return new Error(String(err))
}
