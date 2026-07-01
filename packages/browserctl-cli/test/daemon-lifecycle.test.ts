import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import CDP from "chrome-remote-interface"
import { execute } from "@workspace/browserctl"
import {
  ensureDaemon,
  getDefaultStateFile,
  getStateDir,
  isDaemonHealthy,
  quitDaemon,
  readState,
} from "../src/daemon-manager.js"

function parseCdpPort(log: string): number | null {
  const m = log.match(/debug port (\d+)/)
  return m ? Number(m[1]) : null
}

async function waitUntil(
  fn: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error("waitUntil timeout")
}

function isPidAlive(pid: number): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test(
  "Chrome 关闭后 ensureDaemon 可再次 open（回归 zombie daemon）",
  { timeout: 60000 },
  async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bctl-life-"))
    const prevStateDir = process.env.BROWSERCTL_STATE_DIR
    process.env.BROWSERCTL_STATE_DIR = tmpDir
    t.after(() => {
      quitDaemon()
      if (prevStateDir === undefined) delete process.env.BROWSERCTL_STATE_DIR
      else process.env.BROWSERCTL_STATE_DIR = prevStateDir
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    let baseUrl: string
    try {
      baseUrl = await ensureDaemon({ headless: true })
    } catch (e) {
      t.skip(`无法启动 headless daemon: ${(e as Error).message}`)
      return
    }

    const open1 = await execute(["open", "https://example.com"], baseUrl)
    assert.equal(open1?.ok, true, `首次 open 应成功: ${open1?.error}`)

    const log = fs.readFileSync(path.join(getStateDir(), "daemon.log"), "utf8")
    const cdpPort = parseCdpPort(log)
    assert.ok(cdpPort, `daemon.log 应含 debug port: ${log}`)

    const client = await CDP({ port: cdpPort })
    try {
      await client.Browser.close()
    } finally {
      await client.close()
    }

    await waitUntil(async () => {
      const s = readState(getDefaultStateFile())
      if (!s?.pid) return true
      if (!isPidAlive(s.pid)) return true
      if (!(await isDaemonHealthy(s.port))) return true
      return false
    }, 10000)

    const baseUrl2 = await ensureDaemon({ headless: true })
    const open2 = await execute(["open", "https://example.com"], baseUrl2)
    assert.equal(open2?.ok, true, `Chrome 关闭后再 open 应成功: ${open2?.error}`)
  },
)
