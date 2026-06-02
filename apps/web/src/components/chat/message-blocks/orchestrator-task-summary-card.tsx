"use client"

import * as React from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { MessageResponse } from "@workspace/ui/components/ai-elements/message"

interface Props {
  heading: string
  body: string
  runStatus: string | null
  className?: string
}

const STATUS_TONE: Record<
  string,
  { dot: string; text: string; bg: string; label: string }
> = {
  success: {
    dot: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-400",
    bg: "bg-emerald-500/10",
    label: "成功",
  },
  failed: {
    dot: "bg-red-500",
    text: "text-red-700 dark:text-red-400",
    bg: "bg-red-500/10",
    label: "失败",
  },
  cancelled: {
    dot: "bg-muted-foreground/60",
    text: "text-muted-foreground",
    bg: "bg-muted/60",
    label: "已取消",
  },
  timeout: {
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-500",
    bg: "bg-amber-500/10",
    label: "超时",
  },
}

export function OrchestratorTaskSummaryCard({
  heading,
  body,
  runStatus,
  className,
}: Props) {
  const [expanded, setExpanded] = React.useState(false)
  const tone = STATUS_TONE[runStatus ?? ""] ?? STATUS_TONE.success
  const hasBody = body.trim().length > 0

  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-lg border border-border/60 bg-muted/30",
        className
      )}
    >
      <button
        type="button"
        onClick={() => hasBody && setExpanded((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left text-[13px]",
          hasBody && "hover:bg-muted/60"
        )}
        disabled={!hasBody}
        aria-expanded={expanded}
      >
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
            tone.bg,
            tone.text
          )}
        >
          <span className={cn("size-1.5 rounded-full", tone.dot)} aria-hidden />
          {tone.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-foreground/90">
          {heading}
        </span>
        {hasBody ? (
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-90"
            )}
            aria-hidden
          />
        ) : null}
      </button>
      {expanded && hasBody ? (
        <div className="border-t border-border/40 bg-background/60 px-3 py-2 text-[12px]">
          <MessageResponse>{body}</MessageResponse>
        </div>
      ) : null}
    </div>
  )
}
