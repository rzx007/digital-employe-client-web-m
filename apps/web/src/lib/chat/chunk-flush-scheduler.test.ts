import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { createChunkFlushScheduler } from "./chunk-flush-scheduler"

/**
 * 这些测试用 vitest fake timers 同时模拟 rAF 与 setTimeout。核心要验证的 B-fix 行为：
 * 即便 requestAnimationFrame 永不触发（窗口隐藏被 Chromium 冻结），setTimeout 兜底也能
 * 把 pending chunk drain 出去——这正是「切到别的应用流就丢数据」的根因。
 */
describe("createChunkFlushScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("rAF 正常触发时 drain（跟手路径）", () => {
    const drain = vi.fn()
    const s = createChunkFlushScheduler(drain)
    s.schedule()
    expect(drain).not.toHaveBeenCalled()
    // 推进到下一帧
    vi.advanceTimersToNextFrame()
    expect(drain).toHaveBeenCalledTimes(1)
  })

  it("rAF 被冻结（永不触发）时，setTimeout 兜底仍会 drain", () => {
    // 模拟窗口隐藏：rAF 回调永远不执行
    const frozenRaf = vi.fn((_cb: FrameRequestCallback) => 1 as unknown as number)
    const cancelRaf = vi.fn()
    const drain = vi.fn()
    const s = createChunkFlushScheduler(drain, {
      requestAnimationFrame: frozenRaf,
      cancelAnimationFrame: cancelRaf,
    })

    s.schedule()
    expect(drain).not.toHaveBeenCalled()

    // rAF 不会来，但兜底 setTimeout 到点
    vi.advanceTimersByTime(250)
    expect(drain).toHaveBeenCalledTimes(1)
  })

  it("rAF 与兜底 timer 只 drain 一次（先到者赢，另一个被取消）", () => {
    const drain = vi.fn()
    const s = createChunkFlushScheduler(drain)
    s.schedule()
    vi.advanceTimersToNextFrame() // rAF 先到
    expect(drain).toHaveBeenCalledTimes(1)
    // 继续推进，兜底 timer 不应再触发一次
    vi.advanceTimersByTime(1000)
    expect(drain).toHaveBeenCalledTimes(1)
  })

  it("flushSync 立即 drain 并取消已挂起的 rAF + timer", () => {
    const cancelRaf = vi.fn()
    const drain = vi.fn()
    const s = createChunkFlushScheduler(drain, {
      requestAnimationFrame: vi.fn(() => 1 as unknown as number),
      cancelAnimationFrame: cancelRaf,
    })
    s.schedule()
    s.flushSync()
    expect(drain).toHaveBeenCalledTimes(1)
    expect(cancelRaf).toHaveBeenCalled()
    // flush 后再推进时间不应有第二次 drain（兜底 timer 已清）
    vi.advanceTimersByTime(1000)
    expect(drain).toHaveBeenCalledTimes(1)
  })

  it("已有挂起的 schedule 时再次 schedule 不重复挂 timer（合并到同一批）", () => {
    const raf = vi.fn(() => 1 as unknown as number)
    const drain = vi.fn()
    const s = createChunkFlushScheduler(drain, {
      requestAnimationFrame: raf,
      cancelAnimationFrame: vi.fn(),
    })
    s.schedule()
    s.schedule()
    s.schedule()
    // 只挂一次 rAF
    expect(raf).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(250)
    expect(drain).toHaveBeenCalledTimes(1)
  })

  it("drain 后再次 schedule 能重新触发新一批", () => {
    const drain = vi.fn()
    const s = createChunkFlushScheduler(drain)
    s.schedule()
    vi.advanceTimersToNextFrame()
    expect(drain).toHaveBeenCalledTimes(1)
    s.schedule()
    vi.advanceTimersToNextFrame()
    expect(drain).toHaveBeenCalledTimes(2)
  })
})
