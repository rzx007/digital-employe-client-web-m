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

const STATE_DIR = path.join(os.homedir(), ".browserctl")
export const defaultStateFile = path.join(STATE_DIR, "daemon.json")
const DAEMON_LOG = path.join(STATE_DIR, "daemon.log")

export function readState(file = defaultStateFile): DaemonState | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as DaemonState
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

function pingHealth(port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: "127.0.0.1",
        port,
        path: "/internal/browser/health",
        timeout: timeoutMs,
      },
      (res) => {
        res.resume()
        resolve(res.statusCode === 200)
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

// 确保 daemon 在跑，返回 baseUrl。无则 detached spawn dist/daemon.js 并等就绪。
//
// 改进点（暂缓项落地）：
// - 空闲端口自动选：不再硬编码 34555，避免与已占端口（如 Electron 内嵌桥）冲突。
// - daemon 启动失败可观测：把 daemon stderr 重定向到 ~/.browserctl/daemon.log；
//   子进程在健康前退出则立即读取日志尾部抛出真实原因，不再干等 15s。
// - 复用前校验 state.pid 存活：避免状态文件指向早已死掉的 daemon（或被别的服务占了端口）。
export async function ensureDaemon(
  opts: { browser?: string } = {},
): Promise<string> {
  const state = readState()
  if (state && isPidAlive(state.pid) && (await pingHealth(state.port))) {
    return `http://127.0.0.1:${state.port}`
  }
  const port = await pickFreePort()
  const daemonPath = fileURLToPath(new URL("./daemon.js", import.meta.url)) // 与 cli.js 同目录
  fs.mkdirSync(STATE_DIR, { recursive: true })
  // 每次 ensureDaemon 启动覆盖一次日志（仅后台 daemon 的 stderr；前台 serve 不走这里）
  const logFd = fs.openSync(DAEMON_LOG, "w")
  const child = spawn(
    process.execPath,
    [daemonPath, "--browser", opts.browser ?? "chrome", "--port", String(port)],
    { detached: true, stdio: ["ignore", "ignore", logFd] },
  )
  child.unref()
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    // 子进程在健康前就退出 → 立刻抛真实原因（如 EADDRINUSE / Chrome 不可用）
    if (child.exitCode !== null || child.signalCode) {
      const tail = readLogTail(DAEMON_LOG)
      throw new Error(
        `daemon 启动后立即退出（port=${port}, exitCode=${child.exitCode}, signal=${child.signalCode ?? "-"}）。日志：\n${tail}\n——也可用 \`browserctl serve\` 前台启动看完整输出`,
      )
    }
    if (await pingHealth(port)) {
      writeState(defaultStateFile, {
        port,
        pid: child.pid ?? 0,
        browser: opts.browser ?? "chrome",
        startedAt: Date.now(),
      })
      return `http://127.0.0.1:${port}`
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  const tail = readLogTail(DAEMON_LOG)
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
  try {
    fs.rmSync(defaultStateFile, { force: true })
  } catch {
    /* ignore */
  }
}
