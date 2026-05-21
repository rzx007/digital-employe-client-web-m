import { cn } from "@workspace/ui/lib/utils"

import {
  formatElapsedMs,
  shouldShowMessageElapsed,
} from "../shared/chat-view-shared"

export function MessageElapsedLabel({
  elapsedMs,
  isLastAssistantMessage = false,
  isTurnEnded = true,
  className,
}: {
  elapsedMs: number | null
  isLastAssistantMessage?: boolean
  isTurnEnded?: boolean
  className?: string
}) {
  if (!shouldShowMessageElapsed(elapsedMs, isLastAssistantMessage, isTurnEnded)) {
    return null
  }
  return (
    <p
      className={cn(
        "mt-1 text-[10px] text-muted-foreground/60 opacity-0 transition-opacity duration-150 group-hover:opacity-100",
        className
      )}
    >
      耗时 {formatElapsedMs(elapsedMs!)}
    </p>
  )
}