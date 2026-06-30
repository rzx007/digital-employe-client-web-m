import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { launch } from "chrome-launcher"
import { BrowserController, createBridge } from "@workspace/browser-sdk"
import { ChromeCdpTransport } from "./chrome-transport.js"
import { StandaloneHost } from "./standalone-host.js"

interface Args {
  browser: "chrome" | "edge"
  headless: boolean
  userDataDir?: string
  port: number // bridge port (CLI talks here)
  executable?: string
  cdp?: number // connect to existing debug port instead of launching
}

function parseArgs(argv: string[]): Args {
  const a: Args = { browser: "chrome", headless: false, port: 34555 }
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]
    if (v === "--browser") a.browser = (argv[++i] as Args["browser"]) ?? "chrome"
    else if (v === "--headless") a.headless = true
    else if (v === "--user-data-dir") a.userDataDir = argv[++i]
    else if (v === "--port") a.port = Number(argv[++i]) || 34555
    else if (v === "--executable") a.executable = argv[++i]
    else if (v === "--cdp") a.cdp = Number(argv[++i])
  }
  return a
}

function defaultProfileDir(browser: string): string {
  return path.join(os.homedir(), ".browserctl", `profile-${browser}`)
}

// Windows 常见 Edge 路径列表，按优先级探测
const EDGE_PATHS_WIN = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
]

function resolveExecutable(args: Args): string | undefined {
  if (args.executable) return args.executable
  if (args.browser === "edge") {
    for (const p of EDGE_PATHS_WIN) {
      if (fs.existsSync(p)) return p
    }
    // 未找到：留 undefined，让 chrome-launcher 报错提示用 --executable
    return undefined
  }
  return undefined // chrome: chrome-launcher 自动探测
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  let cdpPort: number
  let chrome: { kill: () => void } | null = null

  if (args.cdp) {
    cdpPort = args.cdp
    console.error(`[browserctl-daemon] connecting to existing Chrome on debug port ${cdpPort}`)
  } else {
    const userDataDir = args.userDataDir ?? defaultProfileDir(args.browser)
    fs.mkdirSync(userDataDir, { recursive: true }) // chrome-launcher 在此目录写 chrome-out.log，须先存在
    // 清理上次未干净退出残留的单例锁：否则新 Chrome 撞锁会把请求转交给"已有实例"再自退，
    // 导致 remote-debugging 端口无人监听 → CDP attach 报 ECONNREFUSED。
    for (const lock of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      try {
        fs.rmSync(path.join(userDataDir, lock), { force: true })
      } catch {
        /* ignore */
      }
    }
    const launched = await launch({
      chromeFlags: args.headless ? ["--headless=new"] : [],
      userDataDir,
      chromePath: resolveExecutable(args),
    })
    chrome = launched
    cdpPort = launched.port
    console.error(
      `[browserctl-daemon] launched ${args.browser} (debug port ${cdpPort}, profile persisted)`,
    )
  }

  const transport = new ChromeCdpTransport({ port: cdpPort })
  await transport.attach()
  const host = new StandaloneHost({})
  const controller = new BrowserController(transport)
  createBridge(controller, host, { port: args.port })
  console.error(
    `[browserctl-daemon] bridge listening on 127.0.0.1:${args.port} — point browserctl at it (BROWSER_RUNTIME_BRIDGE_URL=http://127.0.0.1:${args.port})`,
  )

  // 退出时清理（launch 模式关浏览器；cdp 模式不关，归用户）
  const shutdown = async () => {
    try {
      await transport.detach()
    } catch {
      /* ignore */
    }
    if (chrome) {
      try {
        chrome.kill()
      } catch {
        /* ignore */
      }
    }
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

main().catch((e) => {
  console.error("[browserctl-daemon] fatal:", e)
  process.exit(1)
})
