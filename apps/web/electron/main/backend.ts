import { app } from "electron"
import { spawn, type ChildProcess } from "node:child_process"
import path from "node:path"

/**
 * Python 后端（FastAPI）进程管理
 *
 * 负责在 Electron 主进程中管理 backend.exe 的完整生命周期：
 * - 启动：通过 child_process.spawn 创建子进程，按平台区分进程组策略
 * - 就绪检测：监听 stdout/stderr 输出，匹配 Uvicorn 启动日志
 * - 停止：按平台使用不同方式清理进程树，避免残留孤儿进程
 *
 * 平台差异：
 * - Windows: 无 POSIX 信号，PyInstaller exe 会产生子进程。
 *   使用 taskkill /T /F /PID 杀掉整个进程树。
 * - Linux/macOS: spawn 时设置 detached: true 创建独立进程组，
 *   退出时用 process.kill(-pid, signal) 杀掉整个进程组。
 */

const BACKEND_PORT = 58000
const BACKEND_READY_TIMEOUT = 30_000
const KILL_TIMEOUT = 5000

let backendProcess: ChildProcess | null = null
let backendReady = false

/**
 * 获取 py-server 目录路径
 *
 * 开发环境: <APP_ROOT>/py-server
 * 生产环境: <resourcesPath>/py-server（由 electron-builder extraResources 打包）
 */
function getPyServerPath(): string {
  if (!app.isPackaged) {
    return path.join(process.env.APP_ROOT, "py-server")
  }
  return path.join(process.resourcesPath, "py-server")
}

/**
 * 启动 Python 后端进程
 *
 * 返回一个 Promise，在后端就绪（检测到 Uvicorn 监听日志）或超时时 resolve/reject。
 */
export function startBackend(): Promise<void> {
  return new Promise((resolve, reject) => {
    const pyServerPath = getPyServerPath()
    const exePath = path.join(pyServerPath, "backend.exe")

    console.log(`[Backend] startuping: ${exePath}`)
    console.log(`[Backend] workspace dir: ${pyServerPath}`)

    backendProcess = spawn(exePath, [], {
      cwd: pyServerPath,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      // Linux/macOS: 创建独立进程组，便于退出时整组杀死
      // Windows: detached 不生效，不影响
      detached: process.platform !== "win32",
    })

    const timeout = setTimeout(() => {
      reject(new Error(`后端启动超时 (${BACKEND_READY_TIMEOUT / 1000}s)`))
    }, BACKEND_READY_TIMEOUT)

    /**
     * 就绪检测逻辑
     *
     * 监听 stdout 和 stderr，当输出包含 Uvicorn 监听地址时判定为就绪。
     * Uvicorn 启动日志格式: "Uvicorn running on http://0.0.0.0:58000"
     */
    const checkReady = (log: string) => {
      if (!backendReady && log.includes(`0.0.0.0:${BACKEND_PORT}`)) {
        backendReady = true
        clearTimeout(timeout)
        console.log(`[Backend] port: ${BACKEND_PORT}`)
        resolve()
      }
    }

    backendProcess.stdout?.on("data", (data: Buffer) => {
      const log = data.toString()
      console.log(`[Backend] ${log}`)
      checkReady(log)
    })

    backendProcess.stderr?.on("data", (data: Buffer) => {
      const log = data.toString()
      console.error(`[Backend:stderr] ${log}`)
      checkReady(log)
    })

    backendProcess.on("error", (err) => {
      clearTimeout(timeout)
      console.error(`[Backend] startup failed:`, err)
      backendProcess = null
      reject(err)
    })

    backendProcess.on("exit", (code, signal) => {
      console.log(`[Backend] qiut (code: ${code}, signal: ${signal})`)
      backendProcess = null
      backendReady = false
    })
  })
}

/**
 * 停止 Python 后端进程
 *
 * 按平台区分清理策略，确保子进程也被终止：
 *
 * - Windows: 使用 taskkill /T /F /PID <pid>
 *   /T = 杀掉该进程及其所有子进程（进程树）
 *   /F = 强制终止
 *   PyInstaller 打包的 exe 在 Windows 上会产生 uvicorn worker 子进程，
 *   普通的 process.kill() 只杀父进程，子进程会变成孤儿继续运行。
 *
 * - Linux/macOS: 使用 process.kill(-pid, signal)
 *   负号 PID 表示杀掉整个进程组。
 *   spawn 时设置了 detached: true，子进程与主进程在同一进程组中。
 *   先发送 SIGTERM 优雅退出，超时后发送 SIGKILL 强制终止。
 */
export function stopBackend(): void {
  if (!backendProcess) return

  const pid = backendProcess.pid
  if (!pid) {
    backendProcess = null
    return
  }

  console.log(`[Backend] killing (PID: ${pid})...`)

  if (process.platform === "win32") {
    // Windows: 使用 taskkill 杀进程树
    const killCmd = spawn("taskkill", ["/T", "/F", "/PID", String(pid)], {
      stdio: "ignore",
      detached: true,
    })
    killCmd.unref()
    backendProcess = null
    backendReady = false
  } else {
    // Linux/macOS: 杀进程组
    backendProcess = null
    backendReady = false

    try {
      process.kill(-pid, "SIGTERM")
    } catch {
      // 进程组可能已退出，尝试杀单个进程
      try {
        process.kill(pid, "SIGKILL")
      } catch {
        // 进程已退出，忽略
      }
    }

    // 兜底：SIGTERM 后等待一段时间，如果还没退出则 SIGKILL
    const forceKillTimeout = setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL")
      } catch {
        // 已退出，忽略
      }
    }, KILL_TIMEOUT)

    forceKillTimeout.unref()
  }
}

/**
 * 获取后端运行状态
 */
export function getBackendStatus() {
  return {
    ready: backendReady,
    port: BACKEND_PORT,
    running: backendProcess !== null,
  }
}

/**
 * 获取后端端口号
 */
export function getBackendPort(): number {
  return BACKEND_PORT
}
