import { cn } from "@workspace/ui/lib/utils"

type ContextRingProps = {
  /** 0-100 */
  percent: number
  size?: number
  strokeWidth?: number
  /** 控制进度弧颜色（通过 text-* 类，弧使用 currentColor） */
  className?: string
  trackClassName?: string
}

/** 上下文占用度圆环：底色轨道 + 进度弧（从顶部顺时针）。 */
export function ContextRing({
  percent,
  size = 18,
  strokeWidth = 2.5,
  className,
  trackClassName,
}: ContextRingProps) {
  const clamped = Math.min(
    100,
    Math.max(0, Number.isFinite(percent) ? percent : 0)
  )
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - clamped / 100)
  const center = size / 2

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("shrink-0", className)}
      role="img"
      aria-label={`上下文占用 ${clamped.toFixed(0)}%`}
    >
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        className={cn("stroke-muted-foreground/20", trackClassName)}
      />
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${center} ${center})`}
        className="transition-[stroke-dashoffset] duration-500 ease-out"
      />
    </svg>
  )
}
