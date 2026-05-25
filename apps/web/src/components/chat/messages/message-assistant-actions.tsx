import { cn } from "@workspace/ui/lib/utils"
import {
  shouldShowMessageCopy,
  shouldShowMessageElapsed,
} from "../shared/chat-view-shared"
import { MessageCopyAction } from "./message-copy-action"
import { MessageElapsedLabel } from "./message-elapsed-label"

export function MessageAssistantActions({
  copyText,
  elapsedMs,
  isLastAssistantMessage = false,
  isTurnEnded = true,
  className,
}: {
  copyText: string
  elapsedMs: number | null
  isLastAssistantMessage?: boolean
  isTurnEnded?: boolean
  className?: string
}) {
  const showCopy = shouldShowMessageCopy(isLastAssistantMessage, isTurnEnded)
  const showElapsed = shouldShowMessageElapsed(
    elapsedMs,
    isLastAssistantMessage,
    isTurnEnded
  )

  if (!showCopy && !showElapsed) return null

  return (
    <div
      className={cn(
        "mt-1 flex items-center justify-start gap-1.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100",
        className
      )}
    >
      {showCopy && <MessageCopyAction text={copyText} embedded />}
      {showElapsed && (
        <MessageElapsedLabel
          elapsedMs={elapsedMs}
          isLastAssistantMessage={isLastAssistantMessage}
          isTurnEnded={isTurnEnded}
          className="mt-0 shrink-0 opacity-100"
        />
      )}
    </div>
  )
}
