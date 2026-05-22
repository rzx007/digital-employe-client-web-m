import { app } from "electron"
import log from "electron-log/main"
import path from "node:path"
import { getLogsDir } from "./data-paths"

let initialized = false

/**
 * 主进程日志初始化（在 app.whenReady 之前调用即可）
 */
export function initMainLogger(): void {
  if (initialized) return
  initialized = true

  log.transports.file.resolvePathFn = () =>
    path.join(getLogsDir(), "main.log")
  log.transports.file.level = app.isPackaged ? "info" : "debug"
  log.transports.console.level = app.isPackaged ? "warn" : "debug"

  log.catchErrors({
    showDialog: false,
    onError: (error) => {
      log.error("[uncaught]", error)
    },
  })
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

function formatMeta(meta?: Record<string, unknown>): unknown[] {
  if (!meta || Object.keys(meta).length === 0) return []
  return [meta]
}

/** 按模块/Feature 创建带 scope 前缀的 logger */
export function createLogger(scope: string): Logger {
  const tag = `[${scope}]`
  return {
    debug: (message, meta) => log.debug(tag, message, ...formatMeta(meta)),
    info: (message, meta) => log.info(tag, message, ...formatMeta(meta)),
    warn: (message, meta) => log.warn(tag, message, ...formatMeta(meta)),
    error: (message, meta) => log.error(tag, message, ...formatMeta(meta)),
  }
}

export const rootLogger = createLogger("app")
