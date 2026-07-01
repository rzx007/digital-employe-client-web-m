import test from "node:test"
import assert from "node:assert/strict"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import http from "node:http"
import {
  pickFreePort,
  readState,
  writeState,
  isDaemonHealthy,
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
  await new Promise<void>((resolve, reject) => {
    const srv = net.createServer()
    srv.once("error", reject)
    srv.listen({ host: "127.0.0.1", port }, () => {
      srv.close(() => resolve())
    })
  })
})

test("isDaemonHealthy：200 + cdp_ready:true → true", async () => {
  const srv = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: true, data: { cdp_ready: true } }))
  })
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve))
  const addr = srv.address()
  assert.ok(addr && typeof addr === "object")
  assert.equal(await isDaemonHealthy(addr.port), true)
  await new Promise<void>((resolve) => srv.close(() => resolve()))
})

test("isDaemonHealthy：200 + cdp_ready:false → false", async () => {
  const srv = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: true, data: { cdp_ready: false } }))
  })
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve))
  const addr = srv.address()
  assert.ok(addr && typeof addr === "object")
  assert.equal(await isDaemonHealthy(addr.port), false)
  await new Promise<void>((resolve) => srv.close(() => resolve()))
})

test("isDaemonHealthy：500 → false", async () => {
  const srv = http.createServer((_req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: false, error: "CDP not attached" }))
  })
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve))
  const addr = srv.address()
  assert.ok(addr && typeof addr === "object")
  assert.equal(await isDaemonHealthy(addr.port), false)
  await new Promise<void>((resolve) => srv.close(() => resolve()))
})
