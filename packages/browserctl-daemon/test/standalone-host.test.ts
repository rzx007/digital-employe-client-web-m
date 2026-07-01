import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { StandaloneHost } from "../src/standalone-host.js"

test("requestConfirmation 放行 → true（无人值守，审计日志）", async () => {
  const logs: string[] = []
  const host = new StandaloneHost({ logger: (m) => logs.push(m) })
  assert.equal(await host.requestConfirmation("提交申请？"), true)
  assert.ok(logs.some((l) => l.includes("提交申请")))
})

test("resolveArtifactPath 相对名 → cwd 绝对路径；绝对路径原样", () => {
  const host = new StandaloneHost({})
  assert.equal(host.resolveArtifactPath("shot.png"), path.resolve(process.cwd(), "shot.png"))
  const abs = path.resolve(process.cwd(), "x", "y.png")
  assert.equal(host.resolveArtifactPath(abs), abs)
})

test("ensureBrowser / ensureAttached / close 为 no-op，不抛", async () => {
  const host = new StandaloneHost({})
  await host.ensureBrowser("https://example.com")
  await host.ensureAttached()
  await host.close()
})
