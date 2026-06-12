import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { VoicePlaybackManager } from "./playback-manager"

class FakeAudio {
  static instances: FakeAudio[] = []
  src: string
  paused = true
  currentTime = 0
  duration = 10
  ontimeupdate: (() => void) | null = null
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(src: string) {
    this.src = src
    FakeAudio.instances.push(this)
  }
  play() {
    this.paused = false
    return Promise.resolve()
  }
  pause() {
    this.paused = true
  }
}

describe("VoicePlaybackManager", () => {
  let fetchBlob: ReturnType<typeof vi.fn>
  let manager: VoicePlaybackManager

  beforeEach(() => {
    FakeAudio.instances = []
    vi.stubGlobal("Audio", FakeAudio)
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    })
    fetchBlob = vi.fn(async () => new Blob(["x"]))
    manager = new VoicePlaybackManager(fetchBlob)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("toggle 开始播放并更新状态", async () => {
    await manager.toggle("m1", 1, "voice/a.webm")
    expect(manager.getSnapshot().playingMessageId).toBe("m1")
    expect(FakeAudio.instances).toHaveLength(1)
  })

  it("再次 toggle 同一消息则停止", async () => {
    await manager.toggle("m1", 1, "voice/a.webm")
    await manager.toggle("m1", 1, "voice/a.webm")
    expect(manager.getSnapshot().playingMessageId).toBeNull()
  })

  it("播 B 自动停 A（单实例）", async () => {
    await manager.toggle("m1", 1, "voice/a.webm")
    const first = FakeAudio.instances[0]!
    await manager.toggle("m2", 1, "voice/b.webm")
    expect(first.paused).toBe(true)
    expect(manager.getSnapshot().playingMessageId).toBe("m2")
  })

  it("blob 按消息缓存，重复播放不再请求", async () => {
    await manager.toggle("m1", 1, "voice/a.webm")
    await manager.toggle("m1", 1, "voice/a.webm")
    await manager.toggle("m1", 1, "voice/a.webm")
    expect(fetchBlob).toHaveBeenCalledTimes(1)
  })

  it("播放结束（onended）后状态归零", async () => {
    await manager.toggle("m1", 1, "voice/a.webm")
    FakeAudio.instances[0]!.onended?.()
    expect(manager.getSnapshot().playingMessageId).toBeNull()
  })

  it("并发 toggle：后发起的播放生效，先到的过期请求被丢弃", async () => {
    let resolveA: (b: Blob) => void
    fetchBlob.mockImplementationOnce(
      () => new Promise<Blob>((r) => (resolveA = r))
    )
    const p1 = manager.toggle("m1", 1, "voice/a.webm")
    const p2 = manager.toggle("m2", 1, "voice/b.webm")
    await p2
    resolveA!(new Blob(["a"]))
    await p1
    expect(manager.getSnapshot().playingMessageId).toBe("m2")
    expect(FakeAudio.instances).toHaveLength(1)
  })

  it("拉取失败时抛出且状态保持空", async () => {
    fetchBlob.mockRejectedValueOnce(new Error("404"))
    await expect(manager.toggle("m1", 1, "voice/a.webm")).rejects.toThrow()
    expect(manager.getSnapshot().playingMessageId).toBeNull()
  })
})
