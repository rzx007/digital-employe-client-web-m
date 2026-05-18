import { IconBookmark } from "@tabler/icons-react"
import { MessageResponse } from "@workspace/ui/components/ai-elements/message"
import { cn } from "@workspace/ui/lib/utils"
import type { ComponentProps } from "react"
import { memo } from "react"

function CheckpointRule({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 items-center gap-2 text-xs text-muted-foreground/80",
        className
      )}
    >
      <IconBookmark className="size-3.5 shrink-0 stroke-[1.5]" />
      <span className="shrink-0 font-medium tracking-tight">上下文总结</span>
      <span className="h-px min-w-[2rem] flex-1 bg-border" aria-hidden />
    </div>
  )
}

export type SummarizationCheckpointBlockProps = ComponentProps<"div"> & {
  text: string
}

function SummarizationCheckpointBlockInner({
  text,
  className,
  ...props
}: SummarizationCheckpointBlockProps) {
  const trimmed = text.trim()
  if (!trimmed) return null

  return (
    <div className={cn("not-prose w-full space-y-2", className)} {...props}>
      <CheckpointRule />
      <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2.5">
        <MessageResponse className="text-sm leading-relaxed text-foreground/90 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          {text}
        </MessageResponse>
      </div>
      <CheckpointRule />
    </div>
  )
}

export const SummarizationCheckpointBlock = memo(
  SummarizationCheckpointBlockInner
)
