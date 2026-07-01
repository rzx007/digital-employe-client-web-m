import net from "node:net"
import { createLogger } from "../../core/logger"

const log = createLogger("backend")

export function isPortInUse(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", (err: NodeJS.ErrnoException) => {
      resolve(err.code === "EADDRINUSE")
    })
    server.listen(port, host, () => {
      server.close(() => resolve(false))
    })
  })
}

/** 解析 netstat -ano 输出中监听指定端口的 PID（Windows） */
function parseListeningPidsFromNetstat(stdout: string, port: number): number[] {
  const suffix = `:${port}`
  const pids = new Set<number>()
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.includes("LISTENING") || !line.includes(suffix)) continue
    const parts = line.trim().split(/\s+/)
    const pid = Number(parts[parts.length - 1])
    if (Number.isInteger(pid) && pid > 0) pids.add(pid)
  }
  return [...pids]
}

async function killListenersOnPortWindows(port: number): Promise<number> {
  const { execFile } = await import("node:child_process")
  const { promisify } = await import("node:util")
  const execFileAsync = promisify(execFile)
  const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "tcp"], {
    encoding: "utf8",
    windowsHide: true,
  })
  const pids = parseListeningPidsFromNetstat(stdout, port)
  let killed = 0
  for (const pid of pids) {
    try {
      process.kill(pid)
      killed += 1
      log.info("killed stale listener on backend port", { port, pid })
    } catch {
      // already exited or access denied
    }
  }
  return killed
}

async function killListenersOnPortUnix(port: number): Promise<number> {
  const { execFile } = await import("node:child_process")
  const { promisify } = await import("node:util")
  const execFileAsync = promisify(execFile)
  let stdout = ""
  try {
    const result = await execFileAsync("lsof", ["-ti", `tcp:${port}`], {
      encoding: "utf8",
    })
    stdout = result.stdout
  } catch {
    return 0
  }
  let killed = 0
  for (const line of stdout.split(/\r?\n/)) {
    const pid = Number(line.trim())
    if (!Number.isInteger(pid) || pid <= 0) continue
    try {
      process.kill(pid, "SIGTERM")
      killed += 1
      log.info("killed stale listener on backend port", { port, pid })
    } catch {
      // ignore
    }
  }
  return killed
}

/**
 * 开发模式：若固定端口被占用，尝试结束监听进程（常见于上次 dev:app 未退干净的 uvicorn）。
 */
export async function freeBackendPortIfBusy(
  host: string,
  port: number,
): Promise<void> {
  if (!(await isPortInUse(host, port))) return

  log.warn("backend port in use, attempting to free stale listener", { port })
  const killed =
    process.platform === "win32"
      ? await killListenersOnPortWindows(port)
      : await killListenersOnPortUnix(port)

  if (killed > 0 && !(await isPortInUse(host, port))) {
    log.info("backend port freed", { port })
    return
  }

  throw new Error(
    `后端端口 ${port} 已被占用。请结束占用该端口的进程（常见：残留的 uvicorn 或另开的 pnpm dev:server），或设置 VITE_BACKEND_PORT 使用其他端口。`,
  )
}
