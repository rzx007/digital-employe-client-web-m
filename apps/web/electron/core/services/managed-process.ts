import { spawn, type ChildProcess } from "node:child_process"
import http from "node:http"
import net from "node:net"
import { createLogger, type Logger } from "../logger"

const DEFAULT_READY_TIMEOUT_MS = 30_000
const KILL_TIMEOUT_MS = 5000

export type ManagedProcessReadyConfig =
  | { type: "stdout"; pattern: string }
  | {
      type: "health"
      path: string
      intervalMs?: number
      timeoutMs?: number
    }

export interface ManagedProcessStartOptions {
  command: string[]
  cwd: string
  env?: Record<string, string>
  host?: string
  port?: number
  envPortKey?: string
  ready: ManagedProcessReadyConfig
  readyTimeoutMs?: number
  logScope?: string
  /** 默认非 Windows 为 true；主后端 dev uv 可传 false */
  detached?: boolean
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
}

export interface ManagedProcessHandle {
  readonly pid: number | undefined
  readonly port: number
  readonly baseUrl: string
  stop: () => void
}

function createScopeLogger(scope?: string): Logger {
  return scope ? createLogger(scope) : createLogger("managed-process")
}

function allocateLocalPort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, host, () => {
      const addr = server.address()
      const port =
        typeof addr === "object" && addr && "port" in addr ? addr.port : 0
      server.close((err) => {
        if (err) reject(err)
        else resolve(port)
      })
    })
  })
}

function killProcessTree(pid: number, log: Logger): void {
  log.info("killing process tree", { pid })

  if (process.platform === "win32") {
    const killCmd = spawn("taskkill", ["/T", "/F", "/PID", String(pid)], {
      stdio: "ignore",
      detached: true,
    })
    killCmd.unref()
    return
  }

  try {
    process.kill(-pid, "SIGTERM")
  } catch {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // already exited
    }
  }

  const forceKillTimeout = setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL")
    } catch {
      // already exited
    }
  }, KILL_TIMEOUT_MS)
  forceKillTimeout.unref()
}

function waitForStdoutReady(
  child: ChildProcess,
  pattern: string,
  timeoutMs: number,
  log: Logger,
): Promise<void> {
  const regex = new RegExp(pattern)
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }

    const timeout = setTimeout(() => {
      finish(() =>
        reject(new Error(`Service ready timeout (${timeoutMs}ms, stdout)`)),
      )
    }, timeoutMs)

    const checkLine = (line: string) => {
      if (regex.test(line)) {
        clearTimeout(timeout)
        log.info("ready (stdout)", { pattern })
        finish(() => resolve())
      }
    }

    child.stdout?.on("data", (data: Buffer) => {
      const line = data.toString()
      log.debug("stdout", { line: line.trim() })
      checkLine(line)
    })

    child.stderr?.on("data", (data: Buffer) => {
      const line = data.toString()
      log.debug("stderr", { line: line.trim() })
      checkLine(line)
    })

    child.once("error", (err) => {
      clearTimeout(timeout)
      finish(() => reject(err))
    })

    child.once("exit", (code, signal) => {
      if (settled) return
      clearTimeout(timeout)
      finish(() =>
        reject(
          new Error(
            `Service exited before ready (code ${code}${signal ? `, signal ${signal}` : ""})`,
          ),
        ),
      )
    })
  })
}

function waitForHealthReady(
  host: string,
  port: number,
  path: string,
  intervalMs: number,
  timeoutMs: number,
  log: Logger,
): Promise<void> {
  const url = `http://${host}:${port}${path.startsWith("/") ? path : `/${path}`}`

  return new Promise((resolve, reject) => {
    const started = Date.now()

    const tryOnce = () => {
      if (Date.now() - started >= timeoutMs) {
        clearInterval(timer)
        reject(new Error(`Service ready timeout (${timeoutMs}ms, health ${url})`))
        return
      }

      const req = http.get(url, (res) => {
        res.resume()
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          clearInterval(timer)
          log.info("ready (health)", { url, status: res.statusCode })
          resolve()
        }
      })
      req.on("error", () => {
        // still starting
      })
      req.setTimeout(2000, () => req.destroy())
    }

    const timer = setInterval(tryOnce, intervalMs)
    tryOnce()
  })
}

/**
 * 启动子进程并等待就绪；返回 handle 用于 stop() 与读取 baseUrl
 */
export async function startManagedProcess(
  options: ManagedProcessStartOptions,
): Promise<ManagedProcessHandle> {
  const log = createScopeLogger(options.logScope)
  const host = options.host ?? "127.0.0.1"
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Service host must be 127.0.0.1 or localhost, got ${host}`)
  }

  const port =
    options.port && options.port > 0
      ? options.port
      : await allocateLocalPort(host)

  const envPortKey = options.envPortKey ?? "PORT"
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    [envPortKey]: String(port),
  }

  const detached =
    options.detached ?? process.platform !== "win32"

  const child = spawn(options.command[0], options.command.slice(1), {
    cwd: options.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: childEnv,
    windowsHide: true,
    detached,
  })

  if (options.onExit) {
    child.on("exit", (code, signal) => {
      options.onExit?.(code, signal)
    })
  }

  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS

  if (options.ready.type === "stdout") {
    await waitForStdoutReady(child, options.ready.pattern, readyTimeoutMs, log)
  } else {
    const intervalMs = options.ready.intervalMs ?? 500
    const healthTimeoutMs = options.ready.timeoutMs ?? readyTimeoutMs
    await waitForHealthReady(
      host,
      port,
      options.ready.path,
      intervalMs,
      healthTimeoutMs,
      log,
    )
  }

  const baseUrl = `http://${host}:${port}`
  const pid = child.pid

  log.info("started", { pid, baseUrl, cwd: options.cwd })

  return {
    pid,
    port,
    baseUrl,
    stop: () => {
      if (pid) killProcessTree(pid, log)
    },
  }
}
