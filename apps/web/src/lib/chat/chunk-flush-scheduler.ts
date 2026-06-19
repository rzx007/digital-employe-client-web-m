/**
 * chunk flush 调度器：决定「什么时候把 pending chunk drain 出去」。
 *
 * 背景（B-fix）：原 createChunkFlushBatcher 只用 requestAnimationFrame 调度 drain。
 * 但 Electron 主窗口被遮挡/隐藏时 Chromium 会冻结 rAF——切到别的应用、流仍在到字节，
 * 但一个 chunk 都不 flush 给 useChat，UI 看起来「丢数据」，要切菜单从 DB 重拉才恢复。
 *
 * 修法：rAF 与一个 setTimeout 兜底**同时**挂起，先到者执行 drain、并取消另一个。
 * setTimeout 在后台只被钳到 ~1s 而非冻结，故即便 rAF 永不触发也不会饿死 flush。
 * rAF 仍在则保持「跟手」（下一帧即 drain）；窗口隐藏则由兜底 timer 保底。
 *
 * 调度器只负责「何时 drain」，不持有 pending 数据——drain 回调由调用方提供，
 * 内部读取并清空自己的 pending 队列。可注入 rAF/timer 以便用 fake timers 单测。
 */

/** rAF 不可用时（极端环境）的回退间隔：与退避首跳同量级，足够「跟手」又不抖。 */
const FALLBACK_FLUSH_MS = 16

export type ChunkFlushSchedulerDeps = {
  requestAnimationFrame: (cb: FrameRequestCallback) => number
  cancelAnimationFrame: (handle: number) => void
}

function defaultDeps(): ChunkFlushSchedulerDeps {
  // 浏览器/Electron 渲染进程有全局 rAF；非 DOM 环境（理论上不会跑到）回退纯 timer。
  if (typeof requestAnimationFrame === "function") {
    return {
      requestAnimationFrame: (cb) => requestAnimationFrame(cb),
      cancelAnimationFrame: (h) => cancelAnimationFrame(h),
    }
  }
  return {
    requestAnimationFrame: (cb) =>
      setTimeout(
        () => cb(0),
        FALLBACK_FLUSH_MS
      ) as unknown as number,
    cancelAnimationFrame: (h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>),
  }
}

export function createChunkFlushScheduler(
  drain: () => void,
  deps: ChunkFlushSchedulerDeps = defaultDeps()
) {
  let rafId: number | null = null
  let timerId: ReturnType<typeof setTimeout> | null = null

  const clearPendingSchedules = () => {
    if (rafId !== null) {
      deps.cancelAnimationFrame(rafId)
      rafId = null
    }
    if (timerId !== null) {
      clearTimeout(timerId)
      timerId = null
    }
  }

  const fire = () => {
    // 任一调度先到：先清掉两边的挂起句柄，保证只 drain 一次，再 drain。
    clearPendingSchedules()
    drain()
  }

  const schedule = () => {
    // 已有挂起的一批就并进去，不重复挂（drain 会读取全部 pending）。
    if (rafId !== null || timerId !== null) return
    rafId = deps.requestAnimationFrame(() => fire())
    // 兜底：rAF 被后台冻结时仍能 drain。
    timerId = setTimeout(() => fire(), FALLBACK_FLUSH_MS)
  }

  const flushSync = () => {
    clearPendingSchedules()
    drain()
  }

  return { schedule, flushSync }
}
