import { cn } from "@workspace/ui/lib/utils"
import {
  Collapsible,
  CollapsibleContent,
} from "@workspace/ui/components/collapsible"
import {
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconLoader,
  IconXboxX,
} from "@tabler/icons-react"
import type { ComponentProps } from "react"
import { useEffect, useRef, useState, memo } from "react"
import type { ToolCallSummary } from "@/lib/chat/tool-summarizer"
import { ToolDetailPanel, toolDetailHasContent } from "./tool-detail-panel"
import { ToolTypeIcon } from "./tool-type-icon"

const stateIconMap: Record<string, typeof IconCircleCheck> = {
  "output-available": IconCircleCheck,
  "output-error": IconXboxX,
}

export type ToolActivityLineProps = ComponentProps<"div"> & {
  toolCallId: string
  summary: ToolCallSummary
  state: string
  resultText?: string | null
  input?: unknown
  preliminary?: boolean
  shouldAutoCollapse?: boolean
}

function ToolActivityLineInner({
  toolCallId,
  summary,
  state,
  resultText,
  input,
  preliminary,
  shouldAutoCollapse,
  className,
  ...props
}: ToolActivityLineProps) {
  const StatusIcon = stateIconMap[state] ?? IconLoader
  const isError = state === "output-error"
  const isDone =
    (state === "output-available" && !preliminary) || state === "output-error"
  const isRunning = !isDone
  const isStreaming = state === "input-streaming"
  const isPreliminaryOutput =
    state === "output-available" && preliminary === true

  const hasDetail = toolDetailHasContent(input, summary.toolName, resultText)

  const [isOpen, setIsOpen] = useState(false)
  const didAutoCollapse = useRef(false)

  useEffect(() => {
    if (isStreaming && hasDetail && !isOpen) {
      queueMicrotask(() => setIsOpen(true))
    }
  }, [isStreaming, hasDetail, isOpen])

  useEffect(() => {
    if (isPreliminaryOutput && hasDetail && !isOpen) {
      queueMicrotask(() => setIsOpen(true))
    }
  }, [isPreliminaryOutput, hasDetail, isOpen])

  useEffect(() => {
    if (!shouldAutoCollapse || didAutoCollapse.current) return
    didAutoCollapse.current = true
    queueMicrotask(() => setIsOpen(false))
  }, [shouldAutoCollapse])

  const collapsibleOpen = isRunning || isPreliminaryOutput ? true : isOpen
  const collapsibleToggle =
    isRunning || isPreliminaryOutput
      ? undefined
      : hasDetail
        ? () => setIsOpen((v) => !v)
        : undefined

  const chevronClass = cn(
    "size-3 shrink-0 text-muted-foreground/50 transition-transform",
    !isOpen &&
      "hidden group-hover/tool-activity:block group-focus-visible/tool-activity:block"
  )

  return (
    <div className={cn("not-prose", className)} {...props}>
      <div
        className={cn(
          "group/tool-activity flex h-7 items-center gap-1 rounded-md px-1.5 text-xs",
          hasDetail && !isRunning && "cursor-pointer hover:bg-muted/50",
          isOpen && hasDetail && "bg-muted/30"
        )}
        onClick={collapsibleToggle}
        onKeyDown={
          collapsibleToggle
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  collapsibleToggle()
                }
              }
            : undefined
        }
        role={hasDetail && !isRunning ? "button" : undefined}
        tabIndex={hasDetail && !isRunning ? 0 : undefined}
      >
        <ToolTypeIcon
          toolName={summary.toolName}
          className="size-3.5 shrink-0 text-muted-foreground/70"
        />
        <span className="flex min-w-0 flex-1 items-center gap-0.5">
          <span className="truncate text-foreground/70">{summary.label}</span>
          {hasDetail &&
            !isRunning &&
            (isOpen ? (
              <IconChevronDown className={chevronClass} />
            ) : (
              <IconChevronRight className={chevronClass} />
            ))}
        </span>
        <StatusIcon
          className={cn(
            "size-3.5 shrink-0",
            isRunning && "animate-spin text-muted-foreground/70",
            !isError && !isRunning && "text-green-600/70",
            isError && "text-destructive/70"
          )}
        />
      </div>

      {hasDetail && (
        <Collapsible
          open={collapsibleOpen}
          onOpenChange={isRunning ? undefined : setIsOpen}
        >
          <CollapsibleContent className="bg-muted/10 p-2 dark:bg-muted/40">
            <ToolDetailPanel
              toolCallId={toolCallId}
              toolName={summary.toolName}
              state={state}
              input={input}
              resultText={resultText}
              preliminary={preliminary}
              isRunning={isRunning}
              isOpen={isOpen}
            />
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

export const ToolActivityLine = memo(ToolActivityLineInner)
