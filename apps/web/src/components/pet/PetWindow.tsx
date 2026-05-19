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
import { PET_STATE_LABELS, PET_DURATIONS, type PetState } from "./animation/types"
import {
  usePetVoiceCurator,
  type PetVoiceFeedback,
} from "./use-pet-voice-curator"
import { loadPetSkin, type PetSkin } from "./pet-loader"
import { getMyWorkspace } from "@/api/workspace"
import { getElectronApi } from "@/lib/electron/host"
import "./PetWindow.css"

const PET_DISPLAY_SCALE = 0.55
const DRAG_HOLD_DELAY_MS = 220
const IDLE_HINT_MS = 6000
const IDLE_HINT_TEXT = "点击说话，再点结束并发送"
const RUNNING_STATES: PetState[] = ["running", "running-left", "running-right"]

function bubbleCaptionText(f: PetVoiceFeedback): string {
  if (f.variant === "none") return ""
  return f.detail ? `${f.title}\n${f.detail}` : f.title
}

function bubbleStrongLabel(f: PetVoiceFeedback): string {
  if (f.variant === "error") return PET_STATE_LABELS.failed
  if (f.variant === "success") return PET_STATE_LABELS.jumping
  if (f.variant === "info") return PET_STATE_LABELS.waving
  return PET_STATE_LABELS.idle
}

export function PetWindow() {
  const { isRecording, voiceBusy, feedback, toggleVoiceClick } =
    usePetVoiceCurator()

  const [idleHintDismissed, setIdleHintDismissed] = useState(false)
  const [currentSkin, setCurrentSkin] = useState<PetSkin | null>(null)

  useEffect(() => {
    const api = getElectronApi()
    if (!api?.getSelectedPetSlug) {
      void loadPetSkin("eve").then(setCurrentSkin).catch(console.error)
      return
    }
    void api.getSelectedPetSlug().then((slug) => {
      loadPetSkin(slug).then(setCurrentSkin).catch(console.error)
    })
  }, [])

  useEffect(() => {
    const api = getElectronApi()
    if (!api?.onPetChanged) return
    const cleanup = api.onPetChanged((slug: string) => {
      loadPetSkin(slug).then(setCurrentSkin).catch(console.error)
    })
    return cleanup
  }, [])

  const dragTimerRef = useRef<number | null>(null)
  const dragStartPointRef = useRef<{
    screenX: number
    screenY: number
  } | null>(null)
  const isPointerDownRef = useRef(false)
  const suppressNextClickRef = useRef(false)
  const clickTimerRef = useRef<number | null>(null)

  const [actionState, setActionState] = useState<PetState | null>(null)
  const doubleClickRef = useRef(0)
  const actionTimerRef = useRef<number | null>(null)

  const [prevVariant, setPrevVariant] = useState(feedback.variant)
  const [jumpAcked, setJumpAcked] = useState(false)

  if (feedback.variant !== prevVariant) {
    setPrevVariant(feedback.variant)
    if (feedback.variant !== "success") {
      setJumpAcked(false)
    }
  }

  const handleAnimationComplete = useCallback(() => {
    setJumpAcked(true)
  }, [])

  const petState: PetState = actionState ?? (() => {
    if (feedback.variant === "error") return "failed"
    if (voiceBusy) return "waiting"
    if (isRecording) return "waving"
    if (feedback.variant === "success" && !jumpAcked) return "jumping"
    if (feedback.variant === "info") return "waving"
    return "idle"
  })()

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
    () => bubbleStrongLabel(feedback),
    [feedback]
  )

  useEffect(() => {
    void (async () => {
      const api = getElectronApi()
      if (!api) return
      const status = await api.getAuthStatus()
      if (status.token) {
        localStorage.setItem("token", status.token)
      }
      const user = status.user as { id?: unknown; name?: unknown } | null
      const userId = user?.id != null ? String(user.id) : ""
      const username = user?.name != null ? String(user.name) : ""
      if (!status.token || !userId || !username) return
      try {
        const workspace = await getMyWorkspace(userId, username)
        localStorage.setItem("workspaceId", String(workspace.id))
      } catch (e) {
        console.warn(
          "[PetWindow] Failed to sync workspaceId for API headers",
          e
        )
      }
    })()
  }, [])

  const clearClickTimer = useCallback(() => {
    if (clickTimerRef.current === null) return
    window.clearTimeout(clickTimerRef.current)
    clickTimerRef.current = null
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
      clearClickTimer()
      const startPoint = dragStartPointRef.current
      if (!startPoint) return

      startWindowDragFromPoint(startPoint)
    }, DRAG_HOLD_DELAY_MS)
  }, [clearDragTimer, clearClickTimer])

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

  useEffect(() => {
    return () => {
      if (actionTimerRef.current != null) window.clearTimeout(actionTimerRef.current)
      if (clickTimerRef.current != null) window.clearTimeout(clickTimerRef.current)
    }
  }, [])

  const triggerAction = useCallback(() => {
    const state = RUNNING_STATES[Math.floor(Math.random() * RUNNING_STATES.length)]
    setActionState(state)
    const totalMs = PET_DURATIONS[state].reduce((a, b) => a + b, 0)
    if (actionTimerRef.current != null) window.clearTimeout(actionTimerRef.current)
    actionTimerRef.current = window.setTimeout(() => {
      setActionState(null)
      actionTimerRef.current = null
    }, totalMs)
  }, [])

  const handlePetClick = useCallback(() => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      return
    }

    const now = Date.now()
    const idle = !voiceBusy && !isRecording && feedback.variant === "none" && !actionState

    // Second click within 400ms from idle → double-click action
    if (now - doubleClickRef.current < 400 && idle) {
      clearClickTimer()
      doubleClickRef.current = 0
      triggerAction()
      return
    }

    doubleClickRef.current = now

    if (idle) {
      clearClickTimer()
      clickTimerRef.current = window.setTimeout(() => {
        clickTimerRef.current = null
        void toggleVoiceClick()
      }, 400)
    } else {
      void toggleVoiceClick()
    }
  }, [toggleVoiceClick, actionState, voiceBusy, isRecording, feedback.variant, triggerAction, clearClickTimer])

  const stageAriaLive = feedback.variant === "error" ? "assertive" : "polite"

  if (!currentSkin) {
    return (
      <main className="pet-shell">
        <section className="pet-stage" />
      </main>
    )
  }

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
            key={actionState ? "action" : "normal"}
            scale={PET_DISPLAY_SCALE}
            image={currentSkin.image}
            animations={currentSkin.animations}
            animationName={petState}
            onAnimationComplete={handleAnimationComplete}
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
  const api = getElectronApi()
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
