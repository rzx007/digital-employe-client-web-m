import test from "node:test"
import assert from "node:assert/strict"

import { computeFallbackBounds } from "./viewport-bounds"

// 回归：总管派给浏览器助手任务、用户停在总管页面时，浏览器视口 DOM 未挂载，
// 主进程测不到 bounds。修复前 prepareViewportForBridge 直接抛
// BROWSER_VIEWPORT_NOT_READY；修复后改用内容尺寸兜底，让内嵌浏览器离屏后台
// 正常渲染/导航。本测试锁定兜底布局的计算（HEADER_OFFSET_Y=40, 右侧摊开）。

test("兜底布局：按 widthRatio 在右侧摊开、顶部留 header 偏移", () => {
  const b = computeFallbackBounds(1000, 800, 0.6)
  assert.equal(b.width, 600)
  assert.equal(b.x, 400) // contentWidth - width
  assert.equal(b.y, 40) // HEADER_OFFSET_Y
  assert.equal(b.height, 760) // 800 - 40
})

test("兜底布局：内容高度小于 header 偏移时高度归零，不出负值", () => {
  const b = computeFallbackBounds(1000, 20, 0.6)
  assert.equal(b.height, 0)
})

test("兜底布局：width 用四舍五入（与 computeBounds 旧实现一致）", () => {
  const b = computeFallbackBounds(999, 800, 0.5)
  assert.equal(b.width, 500) // round(499.5)
  assert.equal(b.x, 499)
})
