import test from "node:test"
import assert from "node:assert/strict"

import { buildRefs } from "./ax-tree"

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
  const refs = buildRefs(nodes, 200)
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
  const refs = buildRefs(nodes, 200)
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
  const refs = buildRefs(nodes, 200)
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
  assert.equal(buildRefs(nodes, 2).length, 2)
})

test("无 RootWebArea 时退回遍历全部节点", () => {
  const nodes = [
    { nodeId: "1", role: { value: "button" }, name: { value: "孤立" } },
  ]
  const refs = buildRefs(nodes, 200)
  assert.equal(refs.length, 1)
  assert.equal(refs[0].role, "button")
})
