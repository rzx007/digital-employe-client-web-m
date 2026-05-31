import { cn } from "@workspace/ui/lib/utils"
import {
  IconCircleCheck,
  IconChevronRight,
  IconChevronDown,
  IconLoader,
  IconXboxX,
} from "@tabler/icons-react"
import type { ComponentProps } from "react"
import { useState, useEffect, memo, useRef } from "react"
import {
  Collapsible,
  CollapsibleContent,
} from "@workspace/ui/components/collapsible"
import { ToolTypeIcon } from "./tool-type-icon"
import { ToolDetailPanel, toolDetailHasContent } from "./tool-detail-panel"
import { getWriteFileStreamProgressLabel, getContentLength, isFileWriteLightweightPhase } from "./tool-shared"

import type { ToolCallSummary } from "@/lib/chat/tool-summarizer"

const stateIconMap: Record<string, typeof IconCircleCheck> = {
  "output-available": IconCircleCheck,
  "output-error": IconXboxX,
}

export type ToolActionRowProps = ComponentProps<"div"> & {
  toolCallId: string
  summary: ToolCallSummary
  state: string
  resultText?: string | null
  input?: unknown
  preliminary?: boolean
  /** 由 tool-collapse-policy 计算；为 true 时触发一次自动收起（非完成即收起） */
  shouldAutoCollapse?: boolean
}

function ToolActionRowInner({
  toolCallId,
  summary,
  state,
  resultText,
  input,
  preliminary,
  shouldAutoCollapse,
  className,
  ...props
}: ToolActionRowProps) {
  const StatusIcon = stateIconMap[state] ?? IconLoader
  const isError = state === "output-error"
  const isDone =
    (state === "output-available" && !preliminary) || state === "output-error"
  const isRunning = !isDone
  const isStreaming = state === "input-streaming"
  const isPreliminaryOutput =
    state === "output-available" && preliminary === true

  const isFileWriteTool =
    summary.toolName === "write_file" || summary.toolName === "edit_file"
  const fileWriteContentLength = isFileWriteTool
    ? getContentLength(input, summary.toolName)
    : 0
  const useLightweightFileWrite = isFileWriteLightweightPhase(
    summary.toolName,
    state,
    isRunning,
    fileWriteContentLength
  )
  const skipAutoExpandOnStream = useLightweightFileWrite && isRunning

  const hasContent = toolDetailHasContent(
    input,
    summary.toolName,
    resultText,
    state,
    isRunning
  )

  const streamProgressLabel = getWriteFileStreamProgressLabel(
    input,
    summary.toolName,
    state,
    isRunning
  )
  const rowLabel = streamProgressLabel
    ? `${summary.label} · ${streamProgressLabel}`
    : summary.label

  const [isOpen, setIsOpen] = useState(false)
  const didAutoCollapse = useRef(false)

  useEffect(() => {
    if (skipAutoExpandOnStream) return
    if (isStreaming && hasContent && !isOpen) {
      queueMicrotask(() => setIsOpen(true))
    }
  }, [skipAutoExpandOnStream, isStreaming, hasContent, isOpen])

  useEffect(() => {
    if (isPreliminaryOutput && !isOpen) {
      queueMicrotask(() => setIsOpen(true))
    }
  }, [isPreliminaryOutput, isOpen])

  useEffect(() => {
    if (!shouldAutoCollapse || didAutoCollapse.current) return
    didAutoCollapse.current = true
    queueMicrotask(() => setIsOpen(false))
  }, [shouldAutoCollapse])

  const collapsibleOpen =
    (isRunning || isPreliminaryOutput) && !skipAutoExpandOnStream
      ? true
      : isOpen
  const collapsibleToggle =
    isRunning || isPreliminaryOutput ? undefined : () => setIsOpen((v) => !v)

  const chevronClass = cn(
    "size-3.5 shrink-0 text-muted-foreground/50 transition-transform",
    !isOpen &&
      "hidden group-hover/tool-action-row:block group-focus-visible/tool-action-row:block"
  )

  return (
    <div
      className={cn(
        "w-[90%] rounded-lg border border-border/50 bg-muted/30",
        hasContent && !isRunning && "cursor-pointer select-none",
        className
      )}
      onClick={hasContent && !isRunning ? collapsibleToggle : undefined}
      {...props}
    >
      <div
        className={cn(
          "group/tool-action-row flex items-center gap-2 px-3 py-2 hover:bg-muted/50",
          isOpen && "border-b border-border/50"
        )}
      >
        <ToolTypeIcon
          toolName={summary.toolName}
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <span className="truncate text-xs font-thin text-foreground/70">
            {rowLabel}
          </span>
          {hasContent &&
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
            isRunning && "animate-spin",
            !isError && !isRunning && "text-green-600/70",
            isError && "text-destructive/70"
          )}
        />
      </div>

      {hasContent && (
        <Collapsible
          open={collapsibleOpen}
          onOpenChange={isRunning ? undefined : setIsOpen}
        >
          <CollapsibleContent>
            <div className="px-3 pb-2.5">
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
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

export const ToolActionRow = memo(ToolActionRowInner)
