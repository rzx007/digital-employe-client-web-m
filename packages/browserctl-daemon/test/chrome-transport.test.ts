import test from "node:test"
import assert from "node:assert/strict"
import { ChromeCdpTransport } from "../src/chrome-transport.js"

test("未 attach 时 isAttached=false，sendCommand 抛 BROWSER_UNAVAILABLE", async () => {
  const t = new ChromeCdpTransport({ port: 0 })
  assert.equal(t.isAttached(), false)
  await assert.rejects(() => t.sendCommand("Page.enable"), /BROWSER_UNAVAILABLE/)
})

test("detach 在未连接时幂等不抛", async () => {
  const t = new ChromeCdpTransport({ port: 0 })
  await t.detach() // should not throw
  assert.equal(t.isAttached(), false)
})
