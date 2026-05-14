import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef, useState } from "react"

import { sendCuratorStreamMessage } from "@/lib/pet/send-curator-stream"
import { transcribePetAudio } from "@/lib/pet/transcribe-audio"
import { chatKeys } from "@/lib/query-keys/chat"

export type PetVoiceFeedback =
  | { variant: "none" }
  | { variant: "error"; title: string; detail?: string }
  | { variant: "info"; title: string; detail?: string }
  | { variant: "success"; title: string; detail?: string }

function feedbackAutoClearMs(
  variant: Exclude<PetVoiceFeedback["variant"], "none">
): number {
  switch (variant) {
    case "error":
      return 8000
    case "info":
      return 6000
    case "success":
      return 4000
    default:
      return 6000
  }
}

function getMicErrorCopy(e: unknown): { title: string; detail?: string } {
  const name =
    e instanceof DOMException ? e.name : e instanceof Error ? e.name : ""

  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return {
      title: "需要麦克风权限",
      detail: "请在系统或浏览器设置中允许本应用访问麦克风",
    }
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return {
      title: "未检测到麦克风",
      detail: "请连接麦克风后重试",
    }
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return {
      title: "麦克风被占用",
      detail: "请关闭其他使用麦克风的应用后重试",
    }
  }

  return {
    title: "无法开始录音",
    detail: e instanceof Error ? e.message : undefined,
  }
}

export function usePetVoiceCurator() {
  const queryClient = useQueryClient()

  const [isRecording, setIsRecording] = useState(false)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [feedback, setFeedback] = useState<PetVoiceFeedback>({
    variant: "none",
  })

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startingRef = useRef(false)

  const clearFeedback = useCallback(() => {
    setFeedback({ variant: "none" })
  }, [])

  useEffect(() => {
    if (feedback.variant === "none") return
    const ms = feedbackAutoClearMs(feedback.variant)
    const id = window.setTimeout(() => {
      setFeedback({ variant: "none" })
    }, ms)
    return () => window.clearTimeout(id)
  }, [feedback])

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const stopMediaRecorder = useCallback((): Promise<Blob | null> => {
    const rec = mediaRecorderRef.current
    if (!rec || rec.state === "inactive") {
      mediaRecorderRef.current = null
      cleanupStream()
      return Promise.resolve(null)
    }

    return new Promise((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: rec.mimeType || "audio/webm",
        })
        chunksRef.current = []
        mediaRecorderRef.current = null
        cleanupStream()
        resolve(blob.size > 0 ? blob : null)
      }
      rec.stop()
    })
  }, [cleanupStream])

  const startRecording = useCallback(async () => {
    if (startingRef.current || mediaRecorderRef.current) return false

    clearFeedback()

    if (!navigator.mediaDevices?.getUserMedia) {
      setFeedback({
        variant: "error",
        title: "当前环境不支持录音",
      })
      return false
    }

    startingRef.current = true
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      })
      streamRef.current = stream

      const mime =
        typeof MediaRecorder !== "undefined" &&
        MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : ""

      const mediaRecorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined
      )
      chunksRef.current = []
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      mediaRecorder.start()
      mediaRecorderRef.current = mediaRecorder
      setIsRecording(true)
      return true
    } catch (e) {
      cleanupStream()
      const { title, detail } = getMicErrorCopy(e)
      setFeedback({ variant: "error", title, detail })
      return false
    } finally {
      startingRef.current = false
    }
  }, [cleanupStream, clearFeedback])

  const finishRecordingAndSend = useCallback(async () => {
    setIsRecording(false)
    setVoiceBusy(true)
    try {
      const blob = await stopMediaRecorder()
      if (!blob) {
        setFeedback({
          variant: "info",
          title: "未录制到有效音频",
          detail: "请稍长录音后再点结束",
        })
        return
      }

      const text = (await transcribePetAudio(blob)).trim()
      if (!text) {
        setFeedback({
          variant: "error",
          title: "识别结果为空",
          detail: "请靠近麦克风或检查网络后重试",
        })
        return
      }

      const { conversationId } = await sendCuratorStreamMessage(text)
      await queryClient.invalidateQueries({ queryKey: chatKeys.curator() })
      await queryClient.invalidateQueries({
        queryKey: chatKeys.messages(conversationId),
      })
      setFeedback({
        variant: "success",
        title: "任务已完成",
        detail: "已同步到总管助手",
      })
      // 不自动打开主窗口，仅用气泡提示；主窗口可从托盘打开
      // window.electronApi?.showPet()
    } catch (e) {
      setFeedback({
        variant: "error",
        title: "识别或发送失败",
        detail: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setVoiceBusy(false)
    }
  }, [queryClient, stopMediaRecorder])

  const toggleVoiceClick = useCallback(async () => {
    if (voiceBusy || startingRef.current) return

    if (!isRecording) {
      await startRecording()
    } else {
      await finishRecordingAndSend()
    }
  }, [voiceBusy, isRecording, startRecording, finishRecordingAndSend])

  useEffect(() => {
    return () => {
      const rec = mediaRecorderRef.current
      if (rec && rec.state !== "inactive") {
        rec.stop()
      }
      mediaRecorderRef.current = null
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  return {
    isRecording,
    voiceBusy,
    feedback,
    clearFeedback,
    toggleVoiceClick,
  }
}
