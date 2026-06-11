import * as React from "react"
import { transcribeAudio } from "@/lib/voice/transcribe"
import { computeWaveform } from "@/lib/voice/compute-waveform"

export const MAX_RECORDING_MS = 60_000
export const MIN_RECORDING_MS = 1_000

export type RecorderPhase = "idle" | "recording" | "transcribing"

export interface VoiceRecordingResult {
  text: string
  durationMs: number
  waveform: number[]
  blob: Blob
}

interface UseVoiceRecorderOptions {
  onResult: (result: VoiceRecordingResult) => void
  onError: (message: string) => void
}

/**
 * 录音状态机：idle → recording →（finish）transcribing → idle。
 * 麦克风流由 LiveWaveform 打开并经 attachStream 共享进来（一次授权一条流）。
 * 只产出数据（转写文本/时长/波形/blob），不接触会话 ID——上传在视图层 doSend。
 */
export function useVoiceRecorder({
  onResult,
  onError,
}: UseVoiceRecorderOptions) {
  const [phase, setPhaseState] = React.useState<RecorderPhase>("idle")
  const [elapsedMs, setElapsedMs] = React.useState(0)

  // 与 phase state 同步的 ref：attachStream 等异步回调需要读到最新 phase
  const phaseRef = React.useRef<RecorderPhase>("idle")
  const setPhase = React.useCallback((next: RecorderPhase) => {
    phaseRef.current = next
    setPhaseState(next)
  }, [])

  const recorderRef = React.useRef<MediaRecorder | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const chunksRef = React.useRef<Blob[]>([])
  const startedAtRef = React.useRef(0)
  const tickerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const finishingRef = React.useRef(false)

  const releaseStream = React.useCallback(() => {
    if (tickerRef.current) {
      clearInterval(tickerRef.current)
      tickerRef.current = null
    }
    const recorder = recorderRef.current
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null
      recorder.onstop = null
      recorder.stop()
    }
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    chunksRef.current = []
  }, [])

  const cancel = React.useCallback(() => {
    releaseStream()
    finishingRef.current = false
    setPhase("idle")
    setElapsedMs(0)
  }, [releaseStream, setPhase])

  const finishRef = React.useRef<() => Promise<void>>(async () => {})

  const finish = React.useCallback(async () => {
    if (finishingRef.current) return
    const recorder = recorderRef.current
    if (!recorder || recorder.state === "inactive") return
    finishingRef.current = true

    if (tickerRef.current) {
      clearInterval(tickerRef.current)
      tickerRef.current = null
    }
    const durationMs = Date.now() - startedAtRef.current

    const blob = await new Promise<Blob>((resolve) => {
      const timeout = setTimeout(() => {
        resolve(new Blob(chunksRef.current, { type: "audio/webm" }))
      }, 3000)
      recorder.onstop = () => {
        clearTimeout(timeout)
        resolve(new Blob(chunksRef.current, { type: "audio/webm" }))
      }
      recorder.stop()
    })
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recorderRef.current = null
    chunksRef.current = []

    if (durationMs < MIN_RECORDING_MS) {
      finishingRef.current = false
      setPhase("idle")
      setElapsedMs(0)
      onError("说话时间太短")
      return
    }

    setPhase("transcribing")
    try {
      const text = (await transcribeAudio(blob)).trim()
      if (!text) {
        throw new Error("未识别到语音内容")
      }
      const waveform = await computeWaveform(blob)
      onResult({ text, durationMs, waveform, blob })
    } catch (err) {
      onError(err instanceof Error ? err.message : "语音转写失败")
    } finally {
      finishingRef.current = false
      setPhase("idle")
      setElapsedMs(0)
    }
  }, [onError, onResult, setPhase])

  React.useEffect(() => {
    finishRef.current = finish
  })

  /** 用户点击麦克风：进入 recording 视觉态（LiveWaveform 随之 active 并申请麦克风） */
  const start = React.useCallback(() => {
    chunksRef.current = []
    setElapsedMs(0)
    setPhase("recording")
  }, [setPhase])

  /** LiveWaveform onStreamReady：把它打开的流接给 MediaRecorder */
  const attachStream = React.useCallback((stream: MediaStream) => {
    // 取消/未开始时流才 ready（如授权弹窗期间点了取消），或重复 attach：
    // 直接停掉这条流，避免麦克风泄漏与幽灵录音
    if (phaseRef.current !== "recording" || recorderRef.current) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    streamRef.current = stream
    const recorder = new MediaRecorder(stream)
    recorderRef.current = recorder
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.start()
    startedAtRef.current = Date.now()
    tickerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current
      setElapsedMs(elapsed)
      if (elapsed >= MAX_RECORDING_MS) {
        void finishRef.current()
      }
    }, 200)
  }, [])

  React.useEffect(() => cancel, [cancel])

  return { phase, elapsedMs, start, attachStream, finish, cancel }
}
