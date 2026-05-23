import { useCallback } from "react"
import { Suggestion } from "@workspace/ui/components/ai-elements/suggestion"
import { cn } from "@workspace/ui/lib/utils"

export const CURATOR_GUIDANCE_SUGGESTIONS = [
  "查看一下微博热搜Top10",
  "查看工作空间里有哪些数字员工及其技能",
  "明天下午 3 点提醒我跟进项目进度",
  "汇总本周各数字员工的任务执行情况",
] as const

export function GuidanceSuggestions({
  onSelect,
  disabled = false,
  className,
  compact = false,
}: {
  onSelect: (text: string) => void
  disabled?: boolean
  className?: string
  compact?: boolean
}) {
  const handleClick = useCallback(
    (suggestion: string) => {
      if (disabled) return
      onSelect(suggestion)
    },
    [disabled, onSelect]
  )

  return (
    <div
      className={cn(
        "flex w-full min-w-0 gap-2",
        compact ? "flex-col" : "flex-wrap items-stretch justify-center",
        className
      )}
    >
      {CURATOR_GUIDANCE_SUGGESTIONS.map((suggestion) => (
        <Suggestion
          key={suggestion}
          suggestion={suggestion}
          onClick={handleClick}
          disabled={disabled}
          className={cn(
            "h-auto min-w-0 leading-snug whitespace-normal",
            compact
              ? "w-full justify-start rounded-lg px-3 py-2.5 text-left text-xs"
              : "max-w-[min(100%,22rem)] shrink-0 rounded-full px-4 py-2 text-center text-sm"
          )}
        />
      ))}
    </div>
  )
}
