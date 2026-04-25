import { cn } from "@workspace/ui/lib/utils"
import {
  IconCircleCheck,
  IconCircle,
  IconCode,
  IconFileDescription,
  IconFolder,
  IconListCheck,
  IconLoader,
  IconPencil,
  IconPlayerPlay,
  IconXboxX,
} from "@tabler/icons-react"
import type { ComponentProps } from "react"
import { useRef, useState, useLayoutEffect, useEffect } from "react"
import {
  Collapsible,
  CollapsibleContent,
} from "@workspace/ui/components/collapsible"

import { getSimpleLabel, type ToolCallSummary } from "@/lib/chat/tool-summarizer"

const TOOL_ICON_MAP: Record<string, typeof IconFileDescription> = {
  read_file: IconFileDescription,
  write_file: IconPencil,
  edit_file: IconPencil,
  execute: IconPlayerPlay,
  ls: IconFolder,
  write_todos: IconListCheck,
}

function getToolIcon(toolName: string): typeof IconFileDescription {
  return TOOL_ICON_MAP[toolName] ?? IconCode
}

const stateIconMap: Record<string, typeof IconCircleCheck> = {
  "output-available": IconCircleCheck,
  "output-error": IconXboxX,
}

export type ToolActionRowSimpleProps = ComponentProps<"div"> & {
  summary: ToolCallSummary
  state: string
  resultText?: string | null
  input?: unknown
  preliminary?: boolean
}

export function ToolActionRowSimple({
  summary,
  state,
  resultText,
  preliminary,
  className,
  ...props
}: ToolActionRowSimpleProps) {
  const ToolIcon = getToolIcon(summary.toolName)
  const isError = state === "output-error"
  const isDone = (state === "output-available" && !preliminary) || state === "output-error"
  const isPreliminaryOutput = state === "output-available" && preliminary === true

  const labelState = isError ? "error" : isDone ? "done" : "running"
  const label = getSimpleLabel(summary.toolName, labelState)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const didAutoCollapse = useRef(false)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
  }, [resultText])

  useEffect(() => {
    if (isPreliminaryOutput && !isOpen) {
      setIsOpen(true)
    }
  }, [isPreliminaryOutput, isOpen])

  useEffect(() => {
    if (isDone && resultText && !didAutoCollapse.current) {
      const timer = setTimeout(() => {
        didAutoCollapse.current = true
        setIsOpen(false)
      }, 2500)
      return () => clearTimeout(timer)
    }
  }, [isDone, resultText])

  useEffect(() => {
    if ((isPreliminaryOutput) && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [isPreliminaryOutput, resultText])

  const hasOutput = !!resultText
  const collapsibleOpen = !isDone || isPreliminaryOutput ? true : isOpen
  const collapsibleToggle = !isDone || isPreliminaryOutput ? undefined : () => setIsOpen((v) => !v)

  const StatusIcon = isDone
    ? (isError ? IconXboxX : IconCircleCheck)
    : IconLoader

  return (
    <div
      className={cn(
        "rounded-lg border border-border/50 bg-muted/30 w-[90%]",
        hasOutput && isDone && "cursor-pointer select-none",
        className
      )}
      onClick={hasOutput && isDone ? collapsibleToggle : undefined}
      {...props}
    >
      <div className={cn("flex items-center gap-2 px-3 py-2", isOpen && "border-b border-border/50")}>
        <ToolIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className={cn(
          "flex-1 truncate text-xs font-thin",
          isDone && !isError && "text-muted-foreground",
          isError && "text-destructive/80",
          !isDone && "text-foreground"
        )}>
          {label}
        </span>
        <StatusIcon
          className={cn(
            "size-3.5 shrink-0",
            !isDone && "animate-spin",
            isDone && !isError && "text-green-600/70",
            isError && "text-destructive/70"
          )}
        />
      </div>

      {hasOutput && (
        <Collapsible open={collapsibleOpen} onOpenChange={!isDone || isPreliminaryOutput ? undefined : setIsOpen}>
          <CollapsibleContent>
            <div className="px-3 pb-2.5">
              {isPreliminaryOutput && (
                <div
                  ref={scrollRef}
                  className="overflow-y-auto rounded-md bg-background/60 px-2.5 py-2 text-xs leading-relaxed max-h-52 font-mono text-muted-foreground/70 whitespace-pre-wrap"
                >
                  {resultText}
                  <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-muted-foreground/50 animate-pulse align-text-bottom" />
                </div>
              )}
              {!isPreliminaryOutput && (
                <div
                  className={cn(
                    "rounded-md bg-background/60 px-2.5 py-2 text-xs leading-relaxed max-h-52 overflow-y-auto",
                    isError
                      ? "text-destructive/70"
                      : "font-mono text-muted-foreground/70 whitespace-pre-wrap"
                  )}
                >
                  {resultText}
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}
