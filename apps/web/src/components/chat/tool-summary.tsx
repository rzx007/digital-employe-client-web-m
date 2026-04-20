import { cn } from "@workspace/ui/lib/utils"
import { CheckCircleIcon, LoaderIcon, XCircleIcon } from "lucide-react"
import type { ComponentProps } from "react"

import type { ToolCallSummary } from "@/lib/chat/tool-summarizer"

export type ToolSummaryProps = ComponentProps<"div"> & {
  summary: ToolCallSummary
  state: string
  resultText?: string | null
  compact?: boolean
}

const stateIcons: Record<string, typeof CheckCircleIcon> = {
  "output-available": CheckCircleIcon,
  "output-error": XCircleIcon,
}

export function ToolSummary({
  summary,
  state,
  resultText,
  compact = false,
  className,
  ...props
}: ToolSummaryProps) {
  const Icon = stateIcons[state] ?? LoaderIcon
  const isError = state === "output-error"
  const isRunning =
    !state ||
    state === "input-streaming" ||
    state === "input-available"

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
        <div
          className={cn(
            "mt-0.5 truncate pl-[18px] text-[11px]",
            isError
              ? "text-destructive/60"
              : "text-muted-foreground/50"
          )}
        >
          {resultText}
        </div>
      )}
    </div>
  )
}
