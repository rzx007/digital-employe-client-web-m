import test from "node:test"
import assert from "node:assert/strict"
import { BrowserController } from "../src/controller.js"
import type { Transport } from "../src/transport.js"

function mockTransport(responses: Record<string, unknown> = {}): Transport & { calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = []
  return {
    calls,
    attach: async () => {},
    detach: async () => {},
    isAttached: () => true,
    on: () => {},
    sendCommand: async (method, params) => {
      calls.push([method, params])
      return responses[method] ?? {}
    },
  }
}
test("getUrl 走纯 CDP（不依赖 Electron webContents）", async () => {
  // 现有 CDP fallback 用 Runtime.evaluate("window.location.href")，按其返回形状 mock
  const t = mockTransport({
    "Runtime.evaluate": { result: { value: "https://oa.example.com/" } },
  })
  const c = new BrowserController(t)
  const r = await c.getUrl()
  assert.equal(r.ok, true)
  assert.equal((r.data as { url: string }).url, "https://oa.example.com/")
  // 全是 CDP 方法（含 "."），无 Electron 原生调用
  assert.ok(t.calls.every(([m]) => m.includes(".")))
})

test("snapshot 调 Accessibility.getFullAXTree（命令逻辑复用）", async () => {
  const t = mockTransport({
    "Accessibility.getFullAXTree": { nodes: [{ nodeId: "1", role: { value: "RootWebArea" }, childIds: [] }] },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
  const c = new BrowserController(t)
  const r = await c.snapshot(50)
  assert.equal(r.ok, true)
  assert.ok(t.calls.some(([m]) => m === "Accessibility.getFullAXTree"))
})
