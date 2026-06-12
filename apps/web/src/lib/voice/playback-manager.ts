import { useSyncExternalStore } from "react"
import { fetchVoiceAudioBlob } from "@/api/chat"

export interface VoicePlaybackState {
  playingMessageId: string | null
  /** 0-1 播放进度 */
  progress: number
}

type BlobFetcher = (
  conversationId: number | string,
  path: string
) => Promise<Blob>

const IDLE: VoicePlaybackState = { playingMessageId: null, progress: 0 }

/**
 * 模块级播放单例。消息列表是虚拟滚动，胶囊组件随滚动卸载，
 * 因此 HTMLAudioElement、blob 缓存与播放状态都不能放组件内。
 */
export class VoicePlaybackManager {
  private audio: HTMLAudioElement | null = null
  private objectUrl: string | null = null
  private blobCache = new Map<string, Blob>()
  private listeners = new Set<() => void>()
  private state: VoicePlaybackState = IDLE
  /** 并发 toggle 序号守卫：await fetch 期间被新 toggle 抢占时，过期请求直接放弃 */
  private toggleSeq = 0

  constructor(private fetchBlob: BlobFetcher = fetchVoiceAudioBlob) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): VoicePlaybackState => this.state

  private emit(next: VoicePlaybackState) {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  /** 点击胶囊：未播则播放（自动停掉其他），正在播则停止。 */
  async toggle(
    messageId: string,
    conversationId: number | string,
    audioPath: string
  ) {
    if (this.state.playingMessageId === messageId) {
      this.stop()
      return
    }
    this.stop()
    const seq = ++this.toggleSeq

    let blob = this.blobCache.get(messageId)
    if (!blob) {
      blob = await this.fetchBlob(conversationId, audioPath)
      this.blobCache.set(messageId, blob)
    }
    if (seq !== this.toggleSeq) return

    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    this.audio = audio
    this.objectUrl = url
    audio.ontimeupdate = () => {
      if (audio.duration > 0) {
        this.emit({
          playingMessageId: messageId,
          progress: audio.currentTime / audio.duration,
        })
      }
    }
    audio.onended = () => this.stop()
    audio.onerror = () => this.stop()
    this.emit({ playingMessageId: messageId, progress: 0 })
    await audio.play()
  }

  stop() {
    if (this.audio) {
      this.audio.pause()
      this.audio.ontimeupdate = null
      this.audio.onended = null
      this.audio.onerror = null
      this.audio = null
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
    if (this.state.playingMessageId) {
      this.emit(IDLE)
    }
  }
}

export const voicePlaybackManager = new VoicePlaybackManager()

/** 胶囊组件订阅播放状态（组件卸载不影响播放）。 */
export function useVoicePlayback(): VoicePlaybackState {
  return useSyncExternalStore(
    voicePlaybackManager.subscribe,
    voicePlaybackManager.getSnapshot
  )
}
