import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react"
import { cn } from "@workspace/ui/lib/utils"

import { SpritePlayer } from "./animation/SpritePlayer"
import { petStateLabels, type PetState } from "./animation/types"
import type { SpriteSkinManifest } from "./animation/manifest"
import {
  usePetVoiceCurator,
  type PetVoiceFeedback,
} from "./use-pet-voice-curator"
import "./PetWindow.css"
import manifestData from "./skins/default/manifest.json"
import spritePng from "./skins/default/sprite.png"

const PET_DISPLAY_SCALE = 0.58
const DRAG_HOLD_DELAY_MS = 220
const IDLE_HINT_MS = 6000
const IDLE_HINT_TEXT = "点击说话，再点结束并发送"

const skinManifest: SpriteSkinManifest = {
  ...(manifestData as SpriteSkinManifest),
  image: spritePng,
}

function bubbleCaptionText(f: PetVoiceFeedback): string {
  if (f.variant === "none") return ""
  return f.detail ? `${f.title}\n${f.detail}` : f.title
}

function bubbleStrongLabel(f: PetVoiceFeedback, petState: PetState): string {
  if (f.variant === "error") return petStateLabels.error
  if (f.variant === "success") return "完成"
  if (f.variant === "info") return "提示"
  return petStateLabels[petState]
}

export function PetWindow() {
  const { isRecording, voiceBusy, feedback, toggleVoiceClick } =
    usePetVoiceCurator()

  const [idleHintDismissed, setIdleHintDismissed] = useState(false)

  const dragTimerRef = useRef<number | null>(null)
  const dragStartPointRef = useRef<{
    screenX: number
    screenY: number
  } | null>(null)
  const isPointerDownRef = useRef(false)
  const suppressNextClickRef = useRef(false)

  const petState: PetState = useMemo(() => {
    if (feedback.variant === "error") return "error"
    if (voiceBusy) return "thinking"
    if (isRecording) return "listening"
    return "idle"
  }, [feedback.variant, voiceBusy, isRecording])

  const caption = useMemo(() => {
    if (feedback.variant !== "none") {
      return bubbleCaptionText(feedback)
    }
    if (voiceBusy) {
      return "识别并发送给总管…"
    }
    if (isRecording) {
      return "录音中，再点结束"
    }
    if (idleHintDismissed) {
      return ""
    }
    return IDLE_HINT_TEXT
  }, [feedback, voiceBusy, isRecording, idleHintDismissed])

  useEffect(() => {
    const idle = feedback.variant === "none" && !isRecording && !voiceBusy

    let dismissTimer: number | null = null

    const run = () => {
      if (!idle) {
        setIdleHintDismissed(false)
        return
      }
      setIdleHintDismissed(false)
      dismissTimer = window.setTimeout(() => {
        setIdleHintDismissed(true)
      }, IDLE_HINT_MS)
    }

    const scheduleId = window.setTimeout(run, 0)

    return () => {
      window.clearTimeout(scheduleId)
      if (dismissTimer != null) window.clearTimeout(dismissTimer)
    }
  }, [feedback.variant, isRecording, voiceBusy])

  const bubbleStrong = useMemo(
    () => bubbleStrongLabel(feedback, petState),
    [feedback, petState]
  )

  useEffect(() => {
    void (async () => {
      const api = window.electronApi
      if (!api) return
      const { token } = await api.getAuthStatus()
      if (token) localStorage.setItem("token", token)
    })()
  }, [])

  const clearDragTimer = useCallback(() => {
    if (dragTimerRef.current === null) return
    window.clearTimeout(dragTimerRef.current)
    dragTimerRef.current = null
  }, [])

  const startHoldToDragTimer = useCallback(() => {
    clearDragTimer()

    dragTimerRef.current = window.setTimeout(() => {
      dragTimerRef.current = null

      if (!isPointerDownRef.current) return

      suppressNextClickRef.current = true
      const startPoint = dragStartPointRef.current
      if (!startPoint) return

      startWindowDragFromPoint(startPoint)
    }, DRAG_HOLD_DELAY_MS)
  }, [clearDragTimer])

  const handlePetMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      if (isRecording || voiceBusy) return

      isPointerDownRef.current = true
      suppressNextClickRef.current = false
      dragStartPointRef.current = {
        screenX: event.screenX,
        screenY: event.screenY,
      }
      startHoldToDragTimer()
    },
    [isRecording, voiceBusy, startHoldToDragTimer]
  )

  const handlePetMouseUp = useCallback(() => {
    isPointerDownRef.current = false
    dragStartPointRef.current = null
    clearDragTimer()
  }, [clearDragTimer])

  const handlePetKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return
      event.preventDefault()
      void toggleVoiceClick()
    },
    [toggleVoiceClick]
  )

  useEffect(() => clearDragTimer, [clearDragTimer])

  const handlePetClick = useCallback(() => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      return
    }

    void toggleVoiceClick()
  }, [toggleVoiceClick])

  const stageAriaLive = feedback.variant === "error" ? "assertive" : "polite"

  return (
    <main className="pet-shell" data-state={petState}>
      <section aria-live={stageAriaLive} className="pet-stage">
        <div
          aria-label="数字员工宠物，点击开始或结束语音输入"
          aria-pressed={isRecording}
          className="pet-button"
          onClick={handlePetClick}
          onKeyDown={handlePetKeyDown}
          onMouseDown={handlePetMouseDown}
          onMouseUp={handlePetMouseUp}
          role="button"
          tabIndex={0}
          title={IDLE_HINT_TEXT}
        >
          <SpritePlayer
            scale={PET_DISPLAY_SCALE}
            manifest={skinManifest}
            animationName={petState}
          />
        </div>
        {caption && (
          <div
            className={cn(
              "speech-bubble",
              feedback.variant === "error" && "speech-bubble--error",
              feedback.variant === "info" && "speech-bubble--info",
              feedback.variant === "success" && "speech-bubble--success"
            )}
            role={feedback.variant === "error" ? "alert" : undefined}
          >
            <span title={caption}>{caption}</span>
            <strong>{bubbleStrong}</strong>
          </div>
        )}
      </section>
    </main>
  )
}

function startWindowDragFromPoint(startPoint: {
  screenX: number
  screenY: number
}) {
  const api = window.electronApi
  if (!api) return

  api.getPetPosition().then((startPosition) => {
    if (!startPosition) return

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      api.setPetPosition(
        startPosition.x + event.screenX - startPoint.screenX,
        startPosition.y + event.screenY - startPoint.screenY
      )
    }

    const stopDragging = () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", stopDragging)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", stopDragging)
  })
}
