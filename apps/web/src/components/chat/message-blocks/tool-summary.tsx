import { cn } from "@workspace/ui/lib/utils"
import { IconCircleCheck, IconLoader, IconXboxX } from "@tabler/icons-react"
import { type ComponentProps, useRef, useState, useLayoutEffect } from "react"

import type { ToolCallSummary } from "@/lib/chat/tool-summarizer"

export type ToolSummaryProps = ComponentProps<"div"> & {
  summary: ToolCallSummary
  state: string
  resultText?: string | null
  compact?: boolean
}

const stateIcons: Record<string, typeof IconCircleCheck> = {
  "output-available": IconCircleCheck,
  "output-error": IconXboxX,
}

export function ToolSummary({
  summary,
  state,
  resultText,
  compact = false,
  className,
  ...props
}: ToolSummaryProps) {
  const Icon = stateIcons[state] ?? IconLoader
  const isError = state === "output-error"
  const isRunning =
    !state || state === "input-streaming" || state === "input-available"

  const scrollRef = useRef<HTMLDivElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setIsOverflowing(el.scrollHeight > el.clientHeight)
  }, [resultText])

  return (
    <div className={cn(compact ? "" : "py-0.5", className)} {...props}>
      <div className="flex items-center gap-1.5 text-xs">
        <Icon
          className={cn(
            "size-3 shrink-0",
            isRunning && "animate-spin",
            !isError && !isRunning && "text-green-600/70"
          )}
        />
        <span className="truncate">
          {summary.icon} {summary.label}
        </span>
      </div>
      {resultText && (
        <div className="relative mt-0.5 pl-[18px]">
          <div
            ref={scrollRef}
            className={cn(
              "max-h-16 overflow-y-auto text-[11px]",
              isError ? "text-destructive/60" : "text-muted-foreground/50"
            )}
          >
            {resultText}
          </div>

          {isOverflowing && (
            <div
              className={cn(
                "pointer-events-none absolute right-0 bottom-0 left-0 h-6",
                "bg-gradient-to-t from-background to-transparent"
              )}
            />
          )}
        </div>
      )}
    </div>
  )
}
