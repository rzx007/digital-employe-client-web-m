import { app } from "electron"
import os from "node:os"
import path from "node:path"
import { createLogger } from "../../core/logger"
import {
  startManagedProcess,
  type ManagedProcessHandle,
} from "../../core/services/managed-process"
import { isOfflineMode } from "../../core/runtime-env"

const log = createLogger("backend")

const BACKEND_PORT = Number(process.env.VITE_BACKEND_PORT || 34567)
const BACKEND_READY_TIMEOUT = 30_000

/** 开发模式监听地址：Windows 上对 0.0.0.0 绑定易触发 WinError 10013 */
const DEV_UVICORN_HOST =
  process.env.VITE_BACKEND_HOST ||
  (process.platform === "win32" ? "127.0.0.1" : "0.0.0.0")

let backendHandle: ManagedProcessHandle | null = null
let backendReady = false

function getBackendReadyPattern(): string {
  const port = String(BACKEND_PORT)
  // dev + --reload：reloader 先打印 Uvicorn running，worker 尚未 startup complete
  if (!app.isPackaged) {
    return "Application startup complete"
  }
  return (
    `(?:Uvicorn running|Application startup complete).*${port}` +
    `|${port}.*(?:Uvicorn running|Application startup complete)`
  )
}

function shouldUseArchArm64ForDevUvOnAppleSilicon(): boolean {
  return process.platform === "darwin" && os.machine() === "arm64"
}

function getPyServerPath(): string {
  if (!app.isPackaged) {
    return path.join(process.env.APP_ROOT!, "py-server")
  }
  return path.join(process.resourcesPath, "py-server")
}

function getPackagedBackendBinaryName(): string {
  return process.platform === "win32" ? "backend.exe" : "backend"
}

function resetBackendState(): void {
  backendHandle = null
  backendReady = false
}

function buildDevBackendCommand(): { command: string[]; cwd: string } {
  const serverDir = path.join(process.env.APP_ROOT!, "..", "server")
  const uvArgs = [
    "run",
    "uvicorn",
    "src.server:app",
    "--host",
    DEV_UVICORN_HOST,
    "--port",
    String(BACKEND_PORT),
    "--reload",
  ]
  const useArchArm64 = shouldUseArchArm64ForDevUvOnAppleSilicon()
  if (useArchArm64) {
    log.info("Apple Silicon: spawning uv via arch -arm64")
    return {
      command: ["arch", "-arm64", "uv", ...uvArgs],
      cwd: serverDir,
    }
  }
  return { command: ["uv", ...uvArgs], cwd: serverDir }
}

function buildProdBackendCommand(): { command: string[]; cwd: string } {
  const pyServerPath = getPyServerPath()
  const exePath = path.join(pyServerPath, getPackagedBackendBinaryName())
  return { command: [exePath], cwd: pyServerPath }
}

/**
 * 启动 Python 后端进程（内部使用 ManagedProcess）
 */
export function startBackend(): Promise<void> {
  if (backendHandle && backendReady) {
    return Promise.resolve()
  }

  const isDev = !app.isPackaged
  const { command, cwd } = isDev
    ? buildDevBackendCommand()
    : buildProdBackendCommand()

  if (!isDev) {
    log.info("starting packaged backend", { command: command[0], cwd })
  } else {
    log.info("starting dev server", {
      cwd,
      host: DEV_UVICORN_HOST,
      port: BACKEND_PORT,
    })
  }

  return startManagedProcess({
    command,
    cwd,
    port: BACKEND_PORT,
    host: "127.0.0.1",
    ready: { type: "stdout", pattern: getBackendReadyPattern() },
    readyTimeoutMs: BACKEND_READY_TIMEOUT,
    logScope: "backend",
    detached: isDev ? false : undefined,
    env: {
      ...(isDev
        ? {
            PYTHONUTF8: "1",
            PYTHONIOENCODING: "utf-8",
          }
        : {}),
      // 显式写入，避免 Windows 用户级 OFFLINE_MODE=1 经 process.env 泄漏到 Python
      OFFLINE_MODE: isOfflineMode() ? "1" : "0",
      // 离线开发默认跳过激活门控（与 AGENTS.md ACTIVATION_BYPASS 一致）
      ...(isDev && isOfflineMode() && !process.env.ACTIVATION_BYPASS
        ? { ACTIVATION_BYPASS: "1" }
        : {}),
      ...(process.env.ACTIVATION_BYPASS
        ? { ACTIVATION_BYPASS: process.env.ACTIVATION_BYPASS }
        : {}),
      // 桌面端默认物理路径模式；未显式设置时注入 0，保留环境变量覆盖能力
      ...(process.env.AGENT_VIRTUAL_MODE === undefined
        ? { AGENT_VIRTUAL_MODE: "0" }
        : {}),
    },
    onExit: (code, signal) => {
      log.info("process exit", { code, signal })
      resetBackendState()
    },
  })
    .then((handle) => {
      backendHandle = handle
      backendReady = true
      log.info("ready", { port: BACKEND_PORT })
    })
    .catch((err) => {
      resetBackendState()
      throw err
    })
}

export function stopBackend(): void {
  if (!backendHandle) return
  log.info("stopping backend")
  backendHandle.stop()
  resetBackendState()
}

export function getBackendStatus() {
  return {
    ready: backendReady,
    port: BACKEND_PORT,
    running: backendHandle !== null,
  }
}

export function getBackendPort(): number {
  return BACKEND_PORT
}
