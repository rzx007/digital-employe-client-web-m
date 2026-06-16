import test from "node:test"
import assert from "node:assert/strict"

import { buildCorsResponseHeaders, hasNullOrigin } from "./preview-cors-guard"

test("hasNullOrigin: 识别 Origin 为 null 的请求（沙箱不透明源）", () => {
  assert.equal(hasNullOrigin({ Origin: "null" }), true)
  assert.equal(hasNullOrigin({ origin: "null" }), true) // 大小写不敏感
  assert.equal(hasNullOrigin({ Origin: ["null"] }), true) // 数组值
})

test("hasNullOrigin: app 自身请求带真实 Origin 不命中", () => {
  assert.equal(hasNullOrigin({ Origin: "http://localhost:3399" }), false)
  assert.equal(hasNullOrigin({}), false) // 无 Origin 头
})

test("buildCorsResponseHeaders: 注入放行用的 ACAO 等头", () => {
  const out = buildCorsResponseHeaders({ "Content-Type": ["application/json"] })
  assert.deepEqual(out["Access-Control-Allow-Origin"], ["*"])
  assert.deepEqual(out["Access-Control-Allow-Headers"], ["*"])
  assert.ok(
    Array.isArray(out["Access-Control-Allow-Methods"]) &&
      out["Access-Control-Allow-Methods"][0].includes("GET"),
  )
  // 原有头保留
  assert.deepEqual(out["Content-Type"], ["application/json"])
})

test("buildCorsResponseHeaders: 覆盖已存在的 ACAO（大小写不敏感，不重复）", () => {
  const out = buildCorsResponseHeaders({
    "access-control-allow-origin": ["https://only-this.example"],
  })
  // 旧的小写键应被删除，只剩注入的 "*"
  assert.equal(out["access-control-allow-origin"], undefined)
  assert.deepEqual(out["Access-Control-Allow-Origin"], ["*"])
})

test("buildCorsResponseHeaders: 空响应头也能处理", () => {
  const out = buildCorsResponseHeaders(undefined)
  assert.deepEqual(out["Access-Control-Allow-Origin"], ["*"])
})
