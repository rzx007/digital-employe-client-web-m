import fs from "node:fs"
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
      }
    )
    req.on("error", () => resolve(false))
    req.on("timeout", () => {
      req.destroy()
      resolve(false)
    })
  })
}

// 确保 daemon 在跑，返回 baseUrl。无则 detached spawn dist/daemon.js 并等就绪。
export async function ensureDaemon(
  opts: { browser?: string } = {}
): Promise<string> {
  const state = readState()
  if (state && (await pingHealth(state.port)))
    return `http://127.0.0.1:${state.port}`
  const port = 34555 // TODO: 占用则找空闲端口（后续）
  const daemonPath = fileURLToPath(new URL("./daemon.js", import.meta.url)) // 与 cli.js 同目录
  const child = spawn(
    process.execPath,
    [daemonPath, "--browser", opts.browser ?? "chrome", "--port", String(port)],
    { detached: true, stdio: "ignore" }
  )
  child.unref()
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
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
  throw new Error(
    "daemon 启动超时(15s)：检查 Chrome 是否可用，或用 `browserctl serve` 前台启动看日志"
  )
}

export function quitDaemon(): void {
  const state = readState()
  if (state?.pid) {
    try {
      process.kill(state.pid)
    } catch {
      /* already dead */
    }
  }
  try {
    fs.rmSync(defaultStateFile, { force: true })
  } catch {
    /* ignore */
  }
}
