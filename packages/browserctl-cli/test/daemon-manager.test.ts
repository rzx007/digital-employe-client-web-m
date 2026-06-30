import test from "node:test"
import assert from "node:assert/strict"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import {
  pickFreePort,
  readState,
  writeState,
} from "../src/daemon-manager.js"

test("writeState/readState 往返", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bctl-"))
  const f = path.join(dir, "daemon.json")
  writeState(f, { port: 34556, pid: 999, browser: "chrome", startedAt: 1 })
  assert.deepEqual(readState(f), {
    port: 34556,
    pid: 999,
    browser: "chrome",
    startedAt: 1,
  })
})

test("readState 文件不存在 → null", () => {
  assert.equal(readState(path.join(os.tmpdir(), "nope-bctl-xyz.json")), null)
})

test("pickFreePort 返回 127.0.0.1 上可绑定的端口", async () => {
  const port = await pickFreePort()
  assert.ok(port > 0 && port < 65536, `port 范围异常: ${port}`)
  // 验证该端口确实可绑定（探测后被释放，立刻占用应成功）
  await new Promise<void>((resolve, reject) => {
    const srv = net.createServer()
    srv.once("error", reject)
    srv.listen({ host: "127.0.0.1", port }, () => {
      srv.close(() => resolve())
    })
  })
})
