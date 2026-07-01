import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import http from "node:http"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

export interface DaemonState {
  port: number
  pid: number
  browser: string
  startedAt: number
}

const STATE_DIR = () =>
  process.env.BROWSERCTL_STATE_DIR
    ? path.resolve(process.env.BROWSERCTL_STATE_DIR)
    : path.join(os.homedir(), ".browserctl")

export function getStateDir(): string {
  return STATE_DIR()
}

export function getDefaultStateFile(): string {
  return path.join(STATE_DIR(), "daemon.json")
}

function daemonLogPath(): string {
  return path.join(STATE_DIR(), "daemon.log")
}

export function readState(file?: string): DaemonState | null {
  const f = file ?? getDefaultStateFile()
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) as DaemonState
  } catch {
    return null
  }
}

export function writeState(file: string, s: DaemonState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(s))
}

// 探测一个可绑定的空闲端口（127.0.0.1）。OS 分配后立即释放，存在极小 TOCTOU 竞态；
// 若 daemon 抢端口失败会通过子进程早退 + 日志可观测路径报错，不会静默 15s。
export function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on("error", reject)
    srv.listen({ host: "127.0.0.1", port: 0 }, () => {
      const addr = srv.address()
      if (addr && typeof addr === "object") {
        const port = addr.port
        srv.close(() => resolve(port))
      } else {
        reject(new Error("无法获取空闲端口"))
      }
    })
  })
}

/** GET /health 且校验 body：CDP 不可用（含 cdp_ready:false 或 5xx）视为不健康 */
export async function isDaemonHealthy(
  port: number,
  timeoutMs = 1000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: "127.0.0.1",
        port,
        path: "/internal/browser/health",
        timeout: timeoutMs,
      },
      (res) => {
        let body = ""
        res.on("data", (chunk: Buffer | string) => {
          body += chunk
        })
        res.on("end", () => {
          if (res.statusCode !== 200) {
            resolve(false)
            return
          }
          try {
            const parsed = JSON.parse(body) as {
              ok?: boolean
              data?: { cdp_ready?: boolean }
            }
            resolve(
              parsed.ok === true &&
                (parsed.data?.cdp_ready === undefined ||
                  parsed.data.cdp_ready === true),
            )
          } catch {
            resolve(false)
          }
        })
      },
    )
    req.on("error", () => resolve(false))
    req.on("timeout", () => {
      req.destroy()
      resolve(false)
    })
  })
}

// 0 信号探测 pid 是否存活（不实际发信号）。Windows 上同样可用 process.kill(pid, 0)。
function isPidAlive(pid: number): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readLogTail(file: string, max = 2000): string {
  try {
    const s = fs.readFileSync(file, "utf8")
    return s.length > max ? s.slice(-max) : s
  } catch {
    return "(无日志)"
  }
}

function clearStateFile(): void {
  try {
    fs.rmSync(getDefaultStateFile(), { force: true })
  } catch {
    /* ignore */
  }
}

// 确保 daemon 在跑，返回 baseUrl。无则 detached spawn dist/daemon.js 并等就绪。
export async function ensureDaemon(
  opts: { browser?: string; headless?: boolean } = {},
): Promise<string> {
  const state = readState()
  if (state) {
    if (isPidAlive(state.pid)) {
      if (await isDaemonHealthy(state.port)) {
        return `http://127.0.0.1:${state.port}`
      }
      // pid 在但 CDP/health 失败 → 杀僵尸 daemon 再起
      quitDaemon()
    } else {
      clearStateFile()
    }
  }

  const port = await pickFreePort()
  const { exec, args: daemonArgs } = resolveDaemonSpawnArgs(
    opts.browser ?? "chrome",
    port,
    opts.headless,
  )
  fs.mkdirSync(STATE_DIR(), { recursive: true })
  const logPath = daemonLogPath()
  const logFd = fs.openSync(logPath, "w")
  const child = spawn(exec, daemonArgs, {
    detached: true,
    stdio: ["ignore", "ignore", logFd],
  })
  child.unref()
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode) {
      const tail = readLogTail(logPath)
      throw new Error(
        `daemon 启动后立即退出（port=${port}, exitCode=${child.exitCode}, signal=${child.signalCode ?? "-"}）。日志：\n${tail}\n——也可用 \`browserctl serve\` 前台启动看完整输出`,
      )
    }
    if (await isDaemonHealthy(port)) {
      writeState(getDefaultStateFile(), {
        port,
        pid: child.pid ?? 0,
        browser: opts.browser ?? "chrome",
        startedAt: Date.now(),
      })
      return `http://127.0.0.1:${port}`
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  const tail = readLogTail(logPath)
  throw new Error(
    `daemon 启动超时(15s, port=${port})。日志：\n${tail}\n——检查 Chrome 是否可用，或用 \`browserctl serve\` 前台启动看日志`,
  )
}

export function quitDaemon(): void {
  const state = readState()
  if (state?.pid) {
    if (isPidAlive(state.pid)) {
      try {
        process.kill(state.pid)
      } catch {
        /* already dead */
      }
    }
  }
  clearStateFile()
}

/** dist/daemon.js（发布）或 monorepo 内 tsx 入口（开发/测试） */
function resolveDaemonSpawnArgs(
  browser: string,
  port: number,
  headless?: boolean,
): { exec: string; args: string[] } {
  const bundled = fileURLToPath(new URL("./daemon.js", import.meta.url))
  const flags = [
    "--browser",
    browser,
    "--port",
    String(port),
    ...(headless ? ["--headless"] : []),
  ]
  if (fs.existsSync(bundled)) {
    return { exec: process.execPath, args: [bundled, ...flags] }
  }
  const devEntry = fileURLToPath(
    new URL("../../browserctl-daemon/src/index.ts", import.meta.url),
  )
  return {
    exec: process.execPath,
    args: ["--import", "tsx", devEntry, ...flags],
  }
}
