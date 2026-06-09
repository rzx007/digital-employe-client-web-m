import { describe, expect, it } from "vitest"
import { advanceSpriteFrame } from "./sprite-frame"

const loopOpts = { frameCount: 3, durations: [100, 100, 100], loop: true }
const onceOpts = { frameCount: 3, durations: [100, 100, 100], loop: false }

describe("advanceSpriteFrame", () => {
  it("帧未到时长：不前进、不重绘", () => {
    const r = advanceSpriteFrame(
      { frameCursor: 0, frameElapsedMs: 0, completed: false },
      50,
      loopOpts
    )
    expect(r.frameCursor).toBe(0)
    expect(r.shouldDraw).toBe(false)
    expect(r.finished).toBe(false)
  })

  it("累计到时长：前进一帧并重绘", () => {
    const r = advanceSpriteFrame(
      { frameCursor: 0, frameElapsedMs: 0, completed: false },
      100,
      loopOpts
    )
    expect(r.frameCursor).toBe(1)
    expect(r.shouldDraw).toBe(true)
    expect(r.finished).toBe(false)
  })

  it("循环动画到末尾：回卷到 0、继续不结束", () => {
    const r = advanceSpriteFrame(
      { frameCursor: 2, frameElapsedMs: 0, completed: false },
      100,
      loopOpts
    )
    expect(r.frameCursor).toBe(0)
    expect(r.finished).toBe(false)
    expect(r.shouldDraw).toBe(true)
  })

  it("非循环动画首次播完：停在末帧、completed、finished", () => {
    const r = advanceSpriteFrame(
      { frameCursor: 2, frameElapsedMs: 0, completed: false },
      100,
      onceOpts
    )
    expect(r.frameCursor).toBe(2)
    expect(r.completed).toBe(true)
    expect(r.finished).toBe(true)
  })

  it("已完成的非循环动画：finished 且不重绘空转", () => {
    const r = advanceSpriteFrame(
      { frameCursor: 2, frameElapsedMs: 0, completed: true },
      100,
      onceOpts
    )
    expect(r.finished).toBe(true)
    expect(r.shouldDraw).toBe(false)
  })
})
