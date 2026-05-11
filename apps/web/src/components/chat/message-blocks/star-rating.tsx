import * as React from "react"
import {
  IconStarFilled,
  IconStarHalfFilled,
  IconStar,
} from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"

interface StarRatingProps {
  value: number
  onChange?: (value: number) => void
  disabled?: boolean
  className?: string
  size?: number
}

const MAX_SCORE = 10
const STAR_COUNT = 5

function getStarState(score: number, starIndex: number) {
  const starValue = (starIndex + 1) * 2

  if (score >= starValue) {
    return "full"
  }
  if (score >= starValue - 1) {
    return "half"
  }
  return "empty"
}

function calculateScoreFromClick(
  score: number,
  starIndex: number,
  clickPosition: "left" | "right"
) {
  const starBaseValue = starIndex * 2
  if (clickPosition === "left") {
    return starBaseValue + 1
  }
  return starBaseValue + 2
}

export function StarRating({
  value,
  onChange,
  disabled = false,
  className,
  size = 16,
}: StarRatingProps) {
  const handleClick = React.useCallback(
    (starIndex: number, e: React.MouseEvent<SVGSVGElement>) => {
      if (disabled || !onChange) return

      const rect = e.currentTarget.getBoundingClientRect()
      const clickX = e.clientX - rect.left
      const isLeft = clickX < rect.width / 2

      const newScore = calculateScoreFromClick(
        value,
        starIndex,
        isLeft ? "left" : "right"
      )
      onChange(Math.min(Math.max(newScore, 0.5), MAX_SCORE))
    },
    [value, onChange, disabled]
  )

  const displayScore = Math.round(value * 2) / 2

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <div className="flex items-center">
        {Array.from({ length: STAR_COUNT }, (_, starIndex) => {
          const state = getStarState(displayScore, starIndex)
          const isFilled = state === "full"
          const isHalf = state === "half"

          return (
            <button
              key={starIndex}
              type="button"
              disabled={disabled}
              className={cn(
                "relative inline-flex cursor-pointer transition-colors hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100",
                !disabled && "hover:text-yellow-500"
              )}
              onClick={(e) => handleClick(starIndex, e)}
            >
              {isFilled ? (
                <IconStarFilled className="text-yellow-500" size={size} />
              ) : isHalf ? (
                <IconStarHalfFilled className="text-yellow-500" size={size} />
              ) : (
                <IconStar className="text-muted-foreground" size={size} />
              )}
            </button>
          )
        })}
      </div>
      <span className="min-w-[3ch] text-xs font-medium tabular-nums">
        {Math.round(value * 2) / 2}/{MAX_SCORE}
      </span>
    </div>
  )
}
