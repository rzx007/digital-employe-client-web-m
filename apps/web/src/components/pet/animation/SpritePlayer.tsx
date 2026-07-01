import { useEffect, useRef } from "react"
import type { PetState } from "./types"
import type { PetFrameAnimation } from "../pet-loader"
import { PET_SHEET_COLS, PET_SHEET_FRAME_W, PET_SHEET_FRAME_H } from "./types"
import { advanceSpriteFrame } from "./sprite-frame"

type FrameOffset = {
  x: number
  y: number
}

type SpritePlayerProps = {
  animationName: PetState
  animations: Record<PetState, PetFrameAnimation>
  image: string
  scale: number
  autoAlign?: boolean
  onAnimationComplete?: () => void
}

export function SpritePlayer({
  animationName,
  animations,
  image,
  scale,
  autoAlign = true,
  onAnimationComplete,
}: SpritePlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const completeRef = useRef(false)
  const animation = animations[animationName]

  const displayWidth = PET_SHEET_FRAME_W * scale
  const displayHeight = PET_SHEET_FRAME_H * scale

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext("2d")
    if (!context) return

    const renderingContext = context
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(displayWidth * dpr)
    canvas.height = Math.round(displayHeight * dpr)
    canvas.style.width = `${displayWidth}px`
    canvas.style.height = `${displayHeight}px`

    renderingContext.setTransform(dpr, 0, 0, dpr, 0, 0)
    renderingContext.imageSmoothingEnabled = true
    renderingContext.imageSmoothingQuality = "high"

    const img = new Image()
    let animationFrame = 0
    let lastTimestamp = 0
    let frameCursor = 0
    let frameElapsedMs = 0
    let isDisposed = false
    let started = false

    completeRef.current = false

    const frameCount = Math.max(1, animation.to - animation.from + 1)
    let frameOffsets: FrameOffset[] = []

    function drawFrame(frameIndex: number) {
      const sourceX = (frameIndex % PET_SHEET_COLS) * PET_SHEET_FRAME_W
      const sourceY =
        Math.floor(frameIndex / PET_SHEET_COLS) * PET_SHEET_FRAME_H
      const offset = frameOffsets[frameIndex] ?? { x: 0, y: 0 }

      renderingContext.clearRect(0, 0, displayWidth, displayHeight)
      renderingContext.drawImage(
        img,
        sourceX,
        sourceY,
        PET_SHEET_FRAME_W,
        PET_SHEET_FRAME_H,
        offset.x * scale,
        offset.y * scale,
        displayWidth,
        displayHeight
      )
    }

    function tick(timestamp: number) {
      if (isDisposed) return

      if (lastTimestamp === 0) {
        lastTimestamp = timestamp
      }
      const deltaMs = timestamp - lastTimestamp
      lastTimestamp = timestamp

      const result = advanceSpriteFrame(
        { frameCursor, frameElapsedMs, completed: completeRef.current },
        deltaMs,
        {
          frameCount,
          durations: animation.durations,
          loop: animation.loop,
        }
      )
      frameCursor = result.frameCursor
      frameElapsedMs = result.frameElapsedMs

      if (result.completed && !completeRef.current) {
        completeRef.current = true
        onAnimationComplete?.()
      }

      // 修复①：仅在帧真正切换时重绘（避免 60fps 无差别重绘 + 透明窗反复软件合成）
      if (result.shouldDraw) {
        drawFrame(animation.from + frameCursor)
      }

      // 修复②：非循环动画播完即停 rAF，不再空转
      if (result.finished) {
        animationFrame = 0
        return
      }
      animationFrame = window.requestAnimationFrame(tick)
    }

    function startLoop() {
      if (isDisposed || !started) return
      if (animationFrame !== 0) return // 已在运行
      if (completeRef.current && !animation.loop) return // 非循环已播完，无需恢复
      lastTimestamp = 0 // 重新锚定时间，避免隐藏期间累积时长快进多帧
      animationFrame = window.requestAnimationFrame(tick)
    }

    function pauseLoop() {
      if (animationFrame !== 0) {
        window.cancelAnimationFrame(animationFrame)
        animationFrame = 0
      }
    }

    // 修复③：窗口隐藏/最小化（document.hidden）时彻底暂停动画，可见再恢复。
    // 不挂 blur——宠物窗失焦时仍可见，blur 暂停会让可见的宠物冻住。
    function handleVisibility() {
      if (document.hidden) {
        pauseLoop()
      } else {
        startLoop()
      }
    }
    document.addEventListener("visibilitychange", handleVisibility)

    img.onload = () => {
      frameOffsets = autoAlign ? measureFrameOffsets(img) : []
      started = true
      drawFrame(animation.from)
      if (!document.hidden) {
        startLoop()
      }
    }
    img.onerror = () => {
      console.warn("[SpritePlayer] Failed to load image:", image)
    }
    img.crossOrigin = "anonymous"
    img.src = image

    return () => {
      isDisposed = true
      document.removeEventListener("visibilitychange", handleVisibility)
      window.cancelAnimationFrame(animationFrame)
    }
  }, [
    animation,
    displayWidth,
    displayHeight,
    image,
    scale,
    autoAlign,
    onAnimationComplete,
  ])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="sprite-player"
      height={displayHeight}
      width={displayWidth}
    />
  )
}

function measureFrameOffsets(image: HTMLImageElement): FrameOffset[] {
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d", { willReadFrequently: true })

  if (!context) return []

  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  context.drawImage(image, 0, 0)

  const frameTotal =
    Math.floor(image.naturalWidth / PET_SHEET_FRAME_W) *
    Math.floor(image.naturalHeight / PET_SHEET_FRAME_H)
  const anchors = Array.from({ length: frameTotal }, (_, frameIndex) =>
    measureFrameAnchor(context, frameIndex)
  )
  const validAnchors = anchors.filter((anchor) => anchor !== null) as {
    x: number
    y: number
  }[]

  if (validAnchors.length === 0) return []

  const referenceX = median(validAnchors.map((anchor) => anchor.x))
  const referenceY = median(validAnchors.map((anchor) => anchor.y))

  return anchors.map((anchor) => {
    if (!anchor) return { x: 0, y: 0 }
    return {
      x: Math.round(referenceX - anchor.x),
      y: Math.round(referenceY - anchor.y),
    }
  })
}

function measureFrameAnchor(
  context: CanvasRenderingContext2D,
  frameIndex: number
): { x: number; y: number } | null {
  const sourceX = (frameIndex % PET_SHEET_COLS) * PET_SHEET_FRAME_W
  const sourceY = Math.floor(frameIndex / PET_SHEET_COLS) * PET_SHEET_FRAME_H
  const data = context.getImageData(
    sourceX,
    sourceY,
    PET_SHEET_FRAME_W,
    PET_SHEET_FRAME_H
  ).data
  const alphaThreshold = 18
  const upperLimit = Math.round(PET_SHEET_FRAME_H * 0.62)
  let minX = PET_SHEET_FRAME_W
  let maxX = 0
  let maxY = 0
  let upperMinX = PET_SHEET_FRAME_W
  let upperMaxX = 0

  for (let y = 0; y < PET_SHEET_FRAME_H; y += 1) {
    for (let x = 0; x < PET_SHEET_FRAME_W; x += 1) {
      const alpha = data[(y * PET_SHEET_FRAME_W + x) * 4 + 3]

      if (alpha <= alphaThreshold) continue

      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)

      if (y <= upperLimit) {
        upperMinX = Math.min(upperMinX, x)
        upperMaxX = Math.max(upperMaxX, x)
      }
    }
  }

  if (minX > maxX) return null

  const anchorMinX = upperMinX <= upperMaxX ? upperMinX : minX
  const anchorMaxX = upperMinX <= upperMaxX ? upperMaxX : maxX

  return {
    x: (anchorMinX + anchorMaxX) / 2,
    y: maxY,
  }
}

function median(values: number[]): number {
  const sortedValues = [...values].sort((a, b) => a - b)
  const midpoint = Math.floor(sortedValues.length / 2)

  if (sortedValues.length % 2 === 0) {
    return (sortedValues[midpoint - 1] + sortedValues[midpoint]) / 2
  }

  return sortedValues[midpoint]
}
