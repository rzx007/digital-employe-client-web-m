/**
 * 精灵动画帧推进（纯逻辑，便于单测）。
 *
 * 关键点（修复空转 CPU）：
 * - `shouldDraw` 只在 frameCursor 真正变化时为 true → canvas 不再每个 rAF tick 无差别重绘。
 * - 非循环动画播完后 `finished=true` → 调用方据此停止 requestAnimationFrame、不再空转。
 */
export type SpriteAdvanceState = {
  frameCursor: number
  frameElapsedMs: number
  completed: boolean
}

export type SpriteAdvanceOptions = {
  frameCount: number
  durations: number[]
  loop: boolean
}

export type SpriteAdvanceResult = {
  frameCursor: number
  frameElapsedMs: number
  completed: boolean
  /** 帧是否发生切换（仅此时才需要重绘 canvas） */
  shouldDraw: boolean
  /** 非循环动画已播完（调用方应停止 rAF） */
  finished: boolean
}

export function advanceSpriteFrame(
  state: SpriteAdvanceState,
  deltaMs: number,
  opts: SpriteAdvanceOptions
): SpriteAdvanceResult {
  let frameCursor = state.frameCursor
  let frameElapsedMs = state.frameElapsedMs + Math.max(0, deltaMs)
  let completed = state.completed
  const prevCursor = frameCursor

  while (frameCursor < opts.frameCount) {
    const dur = opts.durations[frameCursor] ?? 100
    if (frameElapsedMs < dur) break
    frameElapsedMs -= dur
    frameCursor++
  }

  let finished = false
  if (frameCursor >= opts.frameCount) {
    if (opts.loop) {
      frameCursor = 0
      frameElapsedMs = 0
    } else if (!completed) {
      completed = true
      frameCursor = opts.frameCount - 1
      finished = true
    } else {
      frameCursor = opts.frameCount - 1
      finished = true
    }
  }

  return {
    frameCursor,
    frameElapsedMs,
    completed,
    shouldDraw: frameCursor !== prevCursor,
    finished,
  }
}
