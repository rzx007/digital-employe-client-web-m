// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/voice/transcribe", () => ({
  transcribeAudio: vi.fn(async () => "你好世界"),
}))
vi.mock("@/lib/voice/compute-waveform", () => ({
  computeWaveform: vi.fn(async () => [10, 50, 100]),
}))

import { transcribeAudio } from "@/lib/voice/transcribe"
import { useVoiceRecorder, MAX_RECORDING_MS } from "./use-voice-recorder"

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  state = "inactive"
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(public stream: MediaStream) {
    FakeMediaRecorder.instances.push(this)
  }
  start() {
    this.state = "recording"
  }
  stop() {
    this.state = "inactive"
    this.ondataavailable?.({ data: new Blob(["audio"]) })
    this.onstop?.()
  }
}

function fakeStream(): MediaStream {
  const track = { stop: vi.fn() }
  return { getTracks: () => [track] } as unknown as MediaStream
}

describe("useVoiceRecorder", () => {
  beforeEach(() => {
    FakeMediaRecorder.instances = []
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder)
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it("start → attachStream 进入 recording 并计时", () => {
    const { result } = renderHook(() =>
      useVoiceRecorder({ onResult: vi.fn(), onError: vi.fn() })
    )
    act(() => result.current.start())
    act(() => result.current.attachStream(fakeStream()))
    expect(result.current.phase).toBe("recording")
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(3000)
  })

  it("finish：转写成功后回调 onResult 并复位", async () => {
    const onResult = vi.fn()
    const { result } = renderHook(() =>
      useVoiceRecorder({ onResult, onError: vi.fn() })
    )
    act(() => result.current.start())
    act(() => result.current.attachStream(fakeStream()))
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    await act(async () => {
      await result.current.finish()
    })
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "你好世界",
        waveform: [10, 50, 100],
        durationMs: expect.any(Number),
        blob: expect.any(Blob),
      })
    )
    expect(result.current.phase).toBe("idle")
  })

  it("短于 1 秒：onError 提示且不转写", async () => {
    const onError = vi.fn()
    const onResult = vi.fn()
    const { result } = renderHook(() =>
      useVoiceRecorder({ onResult, onError })
    )
    act(() => result.current.start())
    act(() => result.current.attachStream(fakeStream()))
    act(() => {
      vi.advanceTimersByTime(300)
    })
    await act(async () => {
      await result.current.finish()
    })
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("太短"))
    expect(onResult).not.toHaveBeenCalled()
    expect(vi.mocked(transcribeAudio)).not.toHaveBeenCalled()
    expect(result.current.phase).toBe("idle")
  })

  it("60 秒自动 finish", async () => {
    const onResult = vi.fn()
    const { result } = renderHook(() =>
      useVoiceRecorder({ onResult, onError: vi.fn() })
    )
    act(() => result.current.start())
    act(() => result.current.attachStream(fakeStream()))
    await act(async () => {
      vi.advanceTimersByTime(MAX_RECORDING_MS + 100)
      await vi.runOnlyPendingTimersAsync()
    })
    expect(onResult).toHaveBeenCalled()
  })

  it("cancel 丢弃数据并释放 track", () => {
    const stream = fakeStream()
    const onResult = vi.fn()
    const { result } = renderHook(() =>
      useVoiceRecorder({ onResult, onError: vi.fn() })
    )
    act(() => result.current.start())
    act(() => result.current.attachStream(stream))
    act(() => result.current.cancel())
    expect(result.current.phase).toBe("idle")
    expect(stream.getTracks()[0]!.stop).toHaveBeenCalled()
    expect(onResult).not.toHaveBeenCalled()
  })

  it("转写失败：onError 且不回调 onResult", async () => {
    vi.mocked(transcribeAudio).mockRejectedValueOnce(new Error("ASR 挂了"))
    const onError = vi.fn()
    const onResult = vi.fn()
    const { result } = renderHook(() =>
      useVoiceRecorder({ onResult, onError })
    )
    act(() => result.current.start())
    act(() => result.current.attachStream(fakeStream()))
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    await act(async () => {
      await result.current.finish()
    })
    expect(onError).toHaveBeenCalled()
    expect(onResult).not.toHaveBeenCalled()
    expect(result.current.phase).toBe("idle")
  })

  it("取消后流才 ready：不接录、立即释放 track", () => {
    const stream = fakeStream()
    const { result } = renderHook(() =>
      useVoiceRecorder({ onResult: vi.fn(), onError: vi.fn() })
    )
    act(() => result.current.start())
    act(() => result.current.cancel())
    act(() => result.current.attachStream(stream))
    expect(stream.getTracks()[0]!.stop).toHaveBeenCalled()
    expect(result.current.phase).toBe("idle")
    expect(FakeMediaRecorder.instances).toHaveLength(0)
  })

  it("卸载时等价取消：释放 track", () => {
    const stream = fakeStream()
    const { result, unmount } = renderHook(() =>
      useVoiceRecorder({ onResult: vi.fn(), onError: vi.fn() })
    )
    act(() => result.current.start())
    act(() => result.current.attachStream(stream))
    unmount()
    expect(stream.getTracks()[0]!.stop).toHaveBeenCalled()
  })
})
