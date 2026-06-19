import { describe, it, expect } from "vitest"
import { GRID_COLS, SPAN_PRESETS, findFreeSlot } from "./grid"

describe("grid constants", () => {
  it("12 列网格", () => {
    expect(GRID_COLS).toBe(12)
  })
  it("四档 span 预设", () => {
    expect(SPAN_PRESETS.small).toEqual({ w: 3, h: 2 })
    expect(SPAN_PRESETS.medium).toEqual({ w: 6, h: 3 })
    expect(SPAN_PRESETS.large).toEqual({ w: 6, h: 6 })
    expect(SPAN_PRESETS.full).toEqual({ w: 12, h: 6 })
  })
})

describe("findFreeSlot", () => {
  it("空网格放左上角", () => {
    expect(findFreeSlot([], { w: 6, h: 3 })).toEqual({ x: 0, y: 0 })
  })
  it("第一格已占 6 宽时，同宽新块落右侧", () => {
    const occupied = [{ x: 0, y: 0, w: 6, h: 3 }]
    expect(findFreeSlot(occupied, { w: 6, h: 3 })).toEqual({ x: 6, y: 0 })
  })
  it("一行放不下时换行", () => {
    const occupied = [
      { x: 0, y: 0, w: 6, h: 3 },
      { x: 6, y: 0, w: 6, h: 3 },
    ]
    expect(findFreeSlot(occupied, { w: 6, h: 3 })).toEqual({ x: 0, y: 3 })
  })
})
