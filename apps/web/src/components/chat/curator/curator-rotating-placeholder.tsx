import { useEffect, useState, type ReactNode } from "react"
import { cn } from "@workspace/ui/lib/utils"

/** 总管输入框轮播占位文案（纯展示） */
export const CURATOR_PLACEHOLDER_HINTS = [
  "描述你想完成的目标或任务，我会拆解并分派给数字员工；输入 @ 可指定经办人",
  "需要新帮手？前往招聘页添加数字员工",
  "不熟悉操作？查看使用指南，快速上手常用功能",
] as const

const ROTATE_INTERVAL_MS = 4000
const FADE_MS = 300

export function CuratorRotatingPlaceholder(): ReactNode {
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches
    let fadeTimeout: ReturnType<typeof setTimeout> | undefined

    const tick = () => {
      if (prefersReducedMotion) {
        setIndex((i) => (i + 1) % CURATOR_PLACEHOLDER_HINTS.length)
        return
      }
      setVisible(false)
      fadeTimeout = window.setTimeout(() => {
        setIndex((i) => (i + 1) % CURATOR_PLACEHOLDER_HINTS.length)
        setVisible(true)
      }, FADE_MS)
    }

    const intervalId = window.setInterval(tick, ROTATE_INTERVAL_MS)
    return () => {
      window.clearInterval(intervalId)
      if (fadeTimeout) window.clearTimeout(fadeTimeout)
    }
  }, [])

  return (
    <span
      className={cn(
        "line-clamp-2 block transition-opacity duration-300 ease-out",
        visible ? "opacity-100" : "opacity-0",
        "motion-reduce:transition-none"
      )}
    >
      {CURATOR_PLACEHOLDER_HINTS[index]}
    </span>
  )
}
