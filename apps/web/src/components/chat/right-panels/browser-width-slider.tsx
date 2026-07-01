import * as React from "react"

import { useBrowserStore } from "@/stores/browser-store"
import { cn } from "@workspace/ui/lib/utils"

const SLIDER_WIDTH_PX = 4
const EDGE_HIT_WIDTH_PX = 10

export function BrowserWidthSlider() {
  const isOpen = useBrowserStore((s) => s.isOpen)
  const widthRatio = useBrowserStore((s) => s.widthRatio)
  const setWidthRatio = useBrowserStore((s) => s.setWidthRatio)
  const [isDragging, setIsDragging] = React.useState(false)

  const startDrag = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(true)
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    []
  )

  React.useEffect(() => {
    if (!isDragging) return
    const handleMove = (e: PointerEvent) => {
      const mainEl = document.querySelector<HTMLElement>(".chat-layout-root")
      if (!mainEl) return
      const rect = mainEl.getBoundingClientRect()
      const x = e.clientX - rect.left
      const ratio = 1 - x / rect.width
      setWidthRatio(ratio)
    }
    const handleUp = () => setIsDragging(false)
    document.addEventListener("pointermove", handleMove)
    document.addEventListener("pointerup", handleUp)
    document.addEventListener("pointercancel", handleUp)
    return () => {
      document.removeEventListener("pointermove", handleMove)
      document.removeEventListener("pointerup", handleUp)
      document.removeEventListener("pointercancel", handleUp)
    }
  }, [isDragging, setWidthRatio])

  if (!isOpen) return null

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="调整浏览器面板宽度"
      onPointerDown={startDrag}
      className={cn(
        "relative z-20 cursor-col-resize bg-border transition-colors",
        isDragging && "bg-primary"
      )}
      style={{
        width: SLIDER_WIDTH_PX,
        marginLeft: -SLIDER_WIDTH_PX / 2,
        alignSelf: "stretch",
        touchAction: "none",
      }}
    >
      <div
        className="absolute inset-y-0"
        style={{ left: -EDGE_HIT_WIDTH_PX / 2, width: EDGE_HIT_WIDTH_PX }}
      />
      <div
        className="absolute inset-y-0"
        style={{ left: SLIDER_WIDTH_PX - EDGE_HIT_WIDTH_PX / 2, width: EDGE_HIT_WIDTH_PX }}
      />
      <div
        className="absolute top-1/2 h-8 w-1 -translate-y-1/2 rounded-full bg-muted-foreground/50"
        style={{ left: (SLIDER_WIDTH_PX - 4) / 2 }}
      />
      <span className="sr-only">宽度 {(widthRatio * 100).toFixed(0)}%</span>
    </div>
  )
}
