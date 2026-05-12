import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react"
import { SpritePlayer } from "./animation/SpritePlayer"
import { petStateLabels, type PetState } from "./animation/types"
import type { SpriteSkinManifest } from "./animation/manifest"
import "./PetWindow.css"
import manifestData from "./skins/default/manifest.json"
import spritePng from "./skins/default/sprite.png"

const PET_DISPLAY_SCALE = 0.58
const DRAG_HOLD_DELAY_MS = 220

const skinManifest: SpriteSkinManifest = {
  ...(manifestData as SpriteSkinManifest),
  image: spritePng,
}

export function PetWindow() {
  const [petState] = useState<PetState>("idle")
  const [caption, setCaption] = useState("点击我打开主窗口")
  const dragTimerRef = useRef<number | null>(null)
  const dragStartPointRef = useRef<{
    screenX: number
    screenY: number
  } | null>(null)
  const isPointerDownRef = useRef(false)
  const suppressNextClickRef = useRef(false)

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

      isPointerDownRef.current = true
      suppressNextClickRef.current = false
      dragStartPointRef.current = {
        screenX: event.screenX,
        screenY: event.screenY,
      }
      startHoldToDragTimer()
    },
    [startHoldToDragTimer],
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
      window.electronApi?.showPet()
    },
    [],
  )

  useEffect(() => clearDragTimer, [clearDragTimer])

  // 首次渲染 6 秒后自动隐藏气泡
  useEffect(() => {
    const timer = window.setTimeout(() => setCaption(""), 6000)
    return () => window.clearTimeout(timer)
  }, [])

  const handlePetClick = useCallback(() => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      return
    }

    setCaption("正在打开...")
    window.electronApi?.showPet()
  }, [])

  return (
    <main className="pet-shell" data-state={petState}>
      <section className="pet-stage" aria-live="polite">
        <div
          aria-label="数字员工宠物"
          className="pet-button"
          onClick={handlePetClick}
          onKeyDown={handlePetKeyDown}
          onMouseDown={handlePetMouseDown}
          onMouseUp={handlePetMouseUp}
          role="button"
          tabIndex={0}
        >
          <SpritePlayer
            scale={PET_DISPLAY_SCALE}
            manifest={skinManifest}
            animationName={petState}
          />
        </div>
        {caption && (
          <div className="speech-bubble">
            <span title={caption}>{caption}</span>
            <strong>{petStateLabels[petState]}</strong>
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
        startPosition.y + event.screenY - startPoint.screenY,
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
