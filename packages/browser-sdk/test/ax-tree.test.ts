import test from "node:test"
import assert from "node:assert/strict"

import { buildRefs } from "../src/ax-tree.js"

test("用 string nodeId/childIds 遍历子树（回归：曾因按 number 判断导致 nodeMap 恒空、@eN 失效）", () => {
  const nodes = [
    {
      nodeId: "1",
      role: { value: "RootWebArea" },
      childIds: ["2"],
      backendDOMNodeId: 1,
    },
    {
      nodeId: "2",
      role: { value: "button" },
      name: { value: "登录" },
      backendDOMNodeId: 5,
    },
  ]
  const refs = buildRefs([nodes], 200)
  assert.deepEqual(
    refs.map((r) => r.role),
    ["RootWebArea", "button"]
  )
  assert.equal(refs[1].name, "登录")
  assert.equal(refs[1].backendNodeId, 5)
})

test("ignored 节点穿透：自身不暴露但继续遍历子节点（回归：曾整棵子树被剪）", () => {
  const nodes = [
    { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"] },
    {
      nodeId: "2",
      ignored: true,
      role: { value: "generic" },
      childIds: ["3"],
    },
    {
      nodeId: "3",
      role: { value: "textbox" },
      name: { value: "用户名" },
      backendDOMNodeId: 7,
    },
  ]
  const refs = buildRefs([nodes], 200)
  assert.deepEqual(
    refs.map((r) => r.role),
    ["RootWebArea", "textbox"]
  )
  assert.equal(refs[1].name, "用户名")
})

test("password role 脱敏为 [masked] 且不暴露其子节点", () => {
  const nodes = [
    { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"] },
    {
      nodeId: "2",
      role: { value: "password" },
      name: { value: "secret-value" },
      backendDOMNodeId: 9,
      childIds: ["3"],
    },
    { nodeId: "3", role: { value: "textbox" }, name: { value: "leak" } },
  ]
  const refs = buildRefs([nodes], 200)
  assert.deepEqual(
    refs.map((r) => r.role),
    ["RootWebArea", "password"]
  )
  assert.equal(refs[1].name, "[masked]")
})

test("maxNodes 截断", () => {
  const nodes = [
    { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2", "3", "4"] },
    { nodeId: "2", role: { value: "button" } },
    { nodeId: "3", role: { value: "button" } },
    { nodeId: "4", role: { value: "button" } },
  ]
  assert.equal(buildRefs([nodes], 2).length, 2)
})

test("无 RootWebArea 时退回遍历全部节点", () => {
  const nodes = [
    { nodeId: "1", role: { value: "button" }, name: { value: "孤立" } },
  ]
  const refs = buildRefs([nodes], 200)
  assert.equal(refs.length, 1)
  assert.equal(refs[0].role, "button")
})

test("多 frame：各组独立 nodeMap，AXNodeId 跨组重名不串，@eN 全局连续编号", () => {
  const mainNodes = [
    { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"], backendDOMNodeId: 1 },
    { nodeId: "2", role: { value: "button" }, name: { value: "主页按钮" }, backendDOMNodeId: 10 },
  ]
  const iframeNodes = [
    // 故意复用 nodeId "1"/"2"，模拟另一 frame 的独立编号
    { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"], backendDOMNodeId: 2 },
    { nodeId: "2", role: { value: "textbox" }, name: { value: "iframe输入" }, backendDOMNodeId: 20 },
  ]
  const refs = buildRefs([mainNodes, iframeNodes], 200)
  const names = refs.map((r) => r.name)
  assert.ok(names.includes("主页按钮"), "主 frame 节点应在")
  assert.ok(names.includes("iframe输入"), "iframe 节点应在")
  // 连续编号 @e0.. 且无重复
  assert.deepEqual(
    refs.map((r) => r.ref),
    refs.map((_, i) => `@e${i}`)
  )
  // backendNodeId 没被另一组同号节点覆盖
  assert.equal(refs.find((r) => r.name === "iframe输入")?.backendNodeId, 20)
})

test("多 frame：maxNodes 跨 frame 全局截断", () => {
  const f1 = [
    { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"] },
    { nodeId: "2", role: { value: "button" } },
  ]
  const f2 = [
    { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"] },
    { nodeId: "2", role: { value: "button" } },
  ]
  assert.equal(buildRefs([f1, f2], 3).length, 3)
})

test("多 frame：空组 / 无 RootWebArea 组不崩", () => {
  const f1 = [
    { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"] },
    { nodeId: "2", role: { value: "button" }, name: { value: "ok" } },
  ]
  const refs = buildRefs([[], f1], 200)
  assert.ok(refs.some((r) => r.name === "ok"))
})

test("buildRefs compact 丢弃 null name/value，保留 ref/role/backendNodeId/depth", () => {
  const nodes = [
    { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2", "3"] },
    { nodeId: "2", role: { value: "button" }, name: { value: "Submit" } },
    { nodeId: "3", role: { value: "generic" } },
  ]
  const refs = buildRefs([nodes], 200, { compact: true })
  const e3 = refs.find((r) => r.role === "generic")
  assert.ok(e3)
  assert.equal(e3.name, undefined)
  assert.equal(e3.value, undefined)
})

test("buildRefs maxDepth 限深", () => {
  const nodes = [
    { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"] },
    {
      nodeId: "2",
      role: { value: "button" },
      name: { value: "A" },
      childIds: ["3"],
    },
    { nodeId: "3", role: { value: "button" }, name: { value: "B" } },
  ]
  const refs = buildRefs([nodes], 200, { maxDepth: 1 })
  assert.ok(refs.some((r) => r.role === "RootWebArea"))
  assert.ok(refs.some((r) => r.name === "A"))
  assert.ok(!refs.some((r) => r.name === "B"))
})
