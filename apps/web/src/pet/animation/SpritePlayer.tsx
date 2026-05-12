import { useEffect, useMemo, useRef } from "react"
import type { PetState } from "./types"
import { getSpriteAnimation, type SpriteSkinManifest } from "./manifest"

type FrameOffset = {
  x: number
  y: number
}

type SpritePlayerProps = {
  animationName: PetState
  manifest: SpriteSkinManifest
  onAnimationComplete?: () => void
  scale?: number
}

export function SpritePlayer({
  animationName,
  manifest,
  onAnimationComplete,
  scale,
}: SpritePlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const completeRef = useRef(false)
  const animation = useMemo(
    () => getSpriteAnimation(manifest, animationName),
    [animationName, manifest],
  )
  const displayScale = scale ?? manifest.scale
  const displayWidth = manifest.frameWidth * displayScale
  const displayHeight = manifest.frameHeight * displayScale

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

    const image = new Image()
    let animationFrame = 0
    let lastTimestamp = 0
    let frameCursor = 0
    let frameElapsedMs = 0
    let isDisposed = false

    completeRef.current = false

    const frameCount = Math.max(1, animation.to - animation.from + 1)
    const frameDurationMs = 1000 / Math.max(1, animation.fps)
    let frameOffsets: FrameOffset[] = []

    function drawFrame(frameIndex: number) {
      const sourceX = (frameIndex % manifest.columns) * manifest.frameWidth
      const sourceY =
        Math.floor(frameIndex / manifest.columns) * manifest.frameHeight
      const offset = frameOffsets[frameIndex] ?? { x: 0, y: 0 }

      renderingContext.clearRect(0, 0, displayWidth, displayHeight)
      renderingContext.drawImage(
        image,
        sourceX,
        sourceY,
        manifest.frameWidth,
        manifest.frameHeight,
        offset.x * displayScale,
        offset.y * displayScale,
        displayWidth,
        displayHeight,
      )
    }

    function tick(timestamp: number) {
      if (isDisposed) return

      if (lastTimestamp === 0) {
        lastTimestamp = timestamp
      }

      frameElapsedMs += timestamp - lastTimestamp
      lastTimestamp = timestamp

      while (frameElapsedMs >= frameDurationMs) {
        frameElapsedMs -= frameDurationMs

        if (frameCursor < frameCount - 1) {
          frameCursor += 1
        } else if (animation.loop) {
          frameCursor = 0
        } else if (!completeRef.current) {
          completeRef.current = true
          onAnimationComplete?.()
        }
      }

      drawFrame(animation.from + frameCursor)
      animationFrame = window.requestAnimationFrame(tick)
    }

    image.onload = () => {
      frameOffsets =
        manifest.autoAlign === false
          ? []
          : measureFrameOffsets(image, manifest)
      drawFrame(animation.from)
      animationFrame = window.requestAnimationFrame(tick)
    }
    image.src = manifest.image

    return () => {
      isDisposed = true
      window.cancelAnimationFrame(animationFrame)
    }
  }, [
    animation,
    displayHeight,
    displayWidth,
    manifest,
    displayScale,
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

function measureFrameOffsets(
  image: HTMLImageElement,
  manifest: SpriteSkinManifest,
): FrameOffset[] {
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d", { willReadFrequently: true })

  if (!context) return []

  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  context.drawImage(image, 0, 0)

  const frameTotal =
    Math.floor(image.naturalWidth / manifest.frameWidth) *
    Math.floor(image.naturalHeight / manifest.frameHeight)
  const anchors = Array.from({ length: frameTotal }, (_, frameIndex) =>
    measureFrameAnchor(context, manifest, frameIndex),
  )
  const validAnchors = anchors.filter((anchor) => anchor !== null)

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
  manifest: SpriteSkinManifest,
  frameIndex: number,
): { x: number; y: number } | null {
  const sourceX = (frameIndex % manifest.columns) * manifest.frameWidth
  const sourceY =
    Math.floor(frameIndex / manifest.columns) * manifest.frameHeight
  const data = context.getImageData(
    sourceX,
    sourceY,
    manifest.frameWidth,
    manifest.frameHeight,
  ).data
  const alphaThreshold = 18
  const upperLimit = Math.round(manifest.frameHeight * 0.62)
  let minX = manifest.frameWidth
  let maxX = 0
  let maxY = 0
  let upperMinX = manifest.frameWidth
  let upperMaxX = 0

  for (let y = 0; y < manifest.frameHeight; y += 1) {
    for (let x = 0; x < manifest.frameWidth; x += 1) {
      const alpha = data[(y * manifest.frameWidth + x) * 4 + 3]

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
