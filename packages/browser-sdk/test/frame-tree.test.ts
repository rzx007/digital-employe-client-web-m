import test from "node:test"
import assert from "node:assert/strict"

import { collectChildFrames } from "../src/frame-tree.js"

test("递归收集所有子 frame id（含嵌套），不含主 frame", () => {
  const tree = {
    frame: { id: "main" },
    childFrames: [
      { frame: { id: "c1" }, childFrames: [{ frame: { id: "c1a" } }] },
      { frame: { id: "c2" } },
    ],
  }
  assert.deepEqual(collectChildFrames(tree), ["c1", "c1a", "c2"])
})

test("三层嵌套全部收集（确认递归任意深度）", () => {
  const tree = {
    frame: { id: "root" },
    childFrames: [
      {
        frame: { id: "l1" },
        childFrames: [
          {
            frame: { id: "l2" },
            childFrames: [{ frame: { id: "l3" } }],
          },
        ],
      },
    ],
  }
  assert.deepEqual(collectChildFrames(tree), ["l1", "l2", "l3"])
})

test("无子 frame 返回空数组", () => {
  assert.deepEqual(collectChildFrames({ frame: { id: "main" } }), [])
})
