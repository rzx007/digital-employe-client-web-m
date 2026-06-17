import { app } from "electron"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createLogger } from "../../core/logger"
import {
  startManagedProcess,
  type ManagedProcessHandle,
} from "../../core/services/managed-process"
import { isOfflineMode } from "../../core/runtime-env"
import { freeBackendPortIfBusy } from "./backend-port"

const log = createLogger("backend")

const BACKEND_PORT = Number(process.env.VITE_BACKEND_PORT || 34567)
// 冷启动覆盖：Python 子进程 import langchain/langgraph 栈在 Windows 实测 8–20s，叠加
// uvicorn lifespan 启动事件后 30s 容易超时（用户实测主仓库冷启动 timeout）。给到 90s。
const BACKEND_READY_TIMEOUT = 90_000

/** 开发模式监听地址：Windows 上对 0.0.0.0 绑定易触发 WinError 10013 */
const DEV_UVICORN_HOST =
  process.env.VITE_BACKEND_HOST ||
  (process.platform === "win32" ? "127.0.0.1" : "0.0.0.0")

let backendHandle: ManagedProcessHandle | null = null
let backendReady = false

/** uvicorn 端口占用等：勿把 "Application startup complete" 当作已可服务 */
const BACKEND_FATAL_LOG_PATTERNS = [
  "error while attempting to bind",
  "EADDRINUSE",
  "Errno 10048",
  "WinError 10048",
]

const BACKEND_HEALTH_READY = {
  type: "health" as const,
  path: "/system/runtime",
  intervalMs: 250,
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
    // 事件循环：用 uvicorn 默认（Windows = ProactorEventLoop）。
    // 此前为规避「Proactor 连接重置洪流后整进程连不上模型」曾强制 SelectorEventLoop
    // （--loop src.uvicorn_selector_loop:loop_factory），2026-06-07 已回退做对比。
  ]
  // Windows 上 --reload 易残留多个监听进程，导致旧代码仍响应 API
  if (process.platform !== "win32") {
    uvArgs.push("--reload")
  }
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
 * browserctl 环境注入：让 Agent 的 shell_execute 无需硬编码绝对路径即可调用。
 *
 * 后端 SkillAwareShellBackend(inherit_env=True) 会把本进程注入的 env 透传给每次
 * shell_execute 子进程，故此处：
 * - BROWSERCTL_PATH：CLI 入口绝对路径（fallback / 文档备用）
 * - PATH 前置 wrapper 目录：使裸命令 `browserctl` 可用（bin/browserctl.cmd|browserctl）
 *
 * packaged：browserctl 经 electron-builder extraResources 打包到 resources/browserctl，
 * 并用 Electron 自带 node 运行（BROWSERCTL_NODE=process.execPath + wrapper 设
 * ELECTRON_RUN_AS_NODE=1），无需目标机器安装 node。
 */
function getBrowserctlEnv(): Record<string, string> {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, "browserctl")
    : path.join(process.env.APP_ROOT!, "..", "..", "packages", "browserctl")
  const binDir = path.join(root, "bin")
  const indexPath = path.join(root, "src", "index.js")
  // Windows 上 process.env 的键名可能是 "Path"；覆盖原键避免大小写重复键歧义
  const pathKey =
    process.platform === "win32"
      ? (Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ??
        "Path")
      : "PATH"
  return {
    BROWSERCTL_PATH: indexPath,
    // wrapper 用此变量运行 CLI：packaged 用 Electron 自带 node（配合 ELECTRON_RUN_AS_NODE），dev 用系统 node
    BROWSERCTL_NODE: app.isPackaged ? process.execPath : "node",
    // open-artifact 用：指向后端，拼会话产物静态 URL（区别于 bridge 的 34555）
    BROWSER_RUNTIME_BACKEND_URL: `http://127.0.0.1:${BACKEND_PORT}`,
    [pathKey]: `${binDir}${path.delimiter}${process.env[pathKey] ?? ""}`,
  }
}

/**
 * 离线依赖注入：让文档类 skill 的 `python scripts/...` 子进程在离线机器上
 * 无需联网安装即可 import 到运维预放的纯 Python 库。
 *
 * 约定：运维在机器上设环境变量 OFFLINE_DEPS_DIR=<某目录>，并把库装到其
 * <dir>/python 子目录（`pip install --target=<dir>/python python-docx ...`）。
 * 此处把该子目录前置注入 PYTHONPATH——经 SkillAwareShellBackend(inherit_env=True)
 * 透传给每次 shell_execute 子进程的系统 python（解释器本身仍由机器自带）。
 *
 * backend.exe 自身是 PyInstaller frozen 应用（隔离模式，自身 import 不读
 * PYTHONPATH），故注入到本进程 env 不会污染后端自身，仅作用于 skill 子进程。
 *
 * 未设置 OFFLINE_DEPS_DIR 或 <dir>/python 不存在时返回空对象，功能默认关闭、零副作用。
 */
function getOfflineDepsEnv(): Record<string, string> {
  const depsDir = process.env.OFFLINE_DEPS_DIR
  if (!depsDir) {
    return {}
  }
  const pythonDir = path.join(depsDir, "python")
  if (!fs.existsSync(pythonDir)) {
    log.info("OFFLINE_DEPS_DIR set but python/ missing; skip", { pythonDir })
    return {}
  }
  // Windows 上 process.env 键名大小写不定，沿用 browserctl 对 PATH 的兜底策略
  const pythonPathKey =
    Object.keys(process.env).find((k) => k.toUpperCase() === "PYTHONPATH") ??
    "PYTHONPATH"
  const existing = process.env[pythonPathKey] ?? ""
  log.info("injecting offline deps into PYTHONPATH", { pythonDir })
  return {
    [pythonPathKey]: existing
      ? `${pythonDir}${path.delimiter}${existing}`
      : pythonDir,
  }
}

/**
 * 启动 Python 后端进程（内部使用 ManagedProcess）
 */
export async function startBackend(): Promise<void> {
  if (backendHandle && backendReady) {
    return
  }

  const isDev = !app.isPackaged
  const backendHost = "127.0.0.1"

  if (isDev) {
    await freeBackendPortIfBusy(backendHost, BACKEND_PORT)
  }

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
    host: backendHost,
    ready: BACKEND_HEALTH_READY,
    readyTimeoutMs: BACKEND_READY_TIMEOUT,
    fatalLogPatterns: BACKEND_FATAL_LOG_PATTERNS,
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
      // 反馈上报需要 app 版本；注入供后端 feedback_service.collect_env 读取
      APP_VERSION: app.getVersion(),
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
      // 上下文语义压缩（SummarizationMiddleware）；设 AGENT_SUMMARIZATION=0 可关闭
      ...(process.env.AGENT_SUMMARIZATION !== undefined
        ? { AGENT_SUMMARIZATION: process.env.AGENT_SUMMARIZATION }
        : { AGENT_SUMMARIZATION: "1" }),
      // browserctl 可调用性：注入 BROWSERCTL_PATH + 前置 wrapper 目录到 PATH
      ...getBrowserctlEnv(),
      // 离线依赖：OFFLINE_DEPS_DIR/python 前置注入 PYTHONPATH（默认关闭）
      ...getOfflineDepsEnv(),
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
    offlinePackage: isOfflineMode(),
  }
}

export function getBackendPort(): number {
  return BACKEND_PORT
}
