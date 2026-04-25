import { cn } from "@workspace/ui/lib/utils"
import {
  IconCircleCheck,
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
import { useRef, useState, useLayoutEffect, useMemo, useEffect } from "react"
import {
  Collapsible,
  CollapsibleContent,
} from "@workspace/ui/components/collapsible"
import { DiffViewer } from "@workspace/ui/components/diff-viewer"
import { CodeHighlight, detectLanguage } from "./code-highlight"

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

const CONTENT_TOOLS = new Set(["write_file", "edit_file"])
const COMMAND_TOOLS = new Set(["execute"])

function getDisplayContent(input: unknown, toolName: string): string | null {
  if (!input || typeof input !== "object") return null
  const obj = input as Record<string, unknown>
  if (CONTENT_TOOLS.has(toolName)) {
    if (toolName === "edit_file") {
      return typeof obj.new_string === "string" && obj.new_string ? obj.new_string : null
    }
    return typeof obj.content === "string" && obj.content ? obj.content : null
  }
  if (COMMAND_TOOLS.has(toolName)) {
    return typeof obj.command === "string" && obj.command ? obj.command : null
  }
  try {
    const json = JSON.stringify(obj, null, 2)
    return json === "{}" ? null : json
  } catch {
    return null
  }
}

function getEditDiff(input: unknown): { oldCode: string; newCode: string } | null {
  if (!input || typeof input !== "object") return null
  const obj = input as Record<string, unknown>
  const oldCode = typeof obj.old_string === "string" ? obj.old_string : null
  const newCode = typeof obj.new_string === "string" ? obj.new_string : null
  return oldCode != null && newCode != null ? { oldCode, newCode } : null
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
  input,
  preliminary,
  className,
  ...props
}: ToolActionRowSimpleProps) {
  const ToolIcon = getToolIcon(summary.toolName)
  const isError = state === "output-error"
  const isDone = (state === "output-available" && !preliminary) || state === "output-error"
  const isRunning = !isDone
  const isStreaming = state === "input-streaming"
  const isPreliminaryOutput = state === "output-available" && preliminary === true

  const labelState = isError ? "error" : isDone ? "done" : "running"
  const label = getSimpleLabel(summary.toolName, labelState)

  const displayContent = useMemo(
    () => getDisplayContent(input, summary.toolName),
    [input, summary.toolName]
  )
  const editDiff = useMemo(
    () => summary.toolName === "edit_file" ? getEditDiff(input) : null,
    [summary.toolName, input]
  )
  const detectedLang = useMemo(
    () => detectLanguage((input as Record<string, unknown> | null)?.file_path as string),
    [input]
  )
  const hasResult = !!resultText
  const hasContent = !!displayContent || hasResult

  const scrollRef = useRef<HTMLDivElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const didAutoCollapse = useRef(false)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setIsOverflowing(el.scrollHeight > el.clientHeight)
  }, [displayContent, resultText])

  useEffect(() => {
    if (isStreaming && displayContent && !isOpen) {
      setIsOpen(true)
    }
  }, [isStreaming, displayContent, isOpen])

  useEffect(() => {
    if (isPreliminaryOutput && !isOpen) {
      setIsOpen(true)
    }
  }, [isPreliminaryOutput, isOpen])

  useEffect(() => {
    if (isDone && (resultText || displayContent) && !didAutoCollapse.current) {
      const timer = setTimeout(() => {
        didAutoCollapse.current = true
        setIsOpen(false)
      }, 2500)
      return () => clearTimeout(timer)
    }
  }, [isDone, resultText, displayContent])

  useEffect(() => {
    if ((isRunning || isPreliminaryOutput) && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [displayContent, isRunning, isPreliminaryOutput, resultText])

  const collapsibleOpen = isRunning || isPreliminaryOutput ? true : isOpen
  const collapsibleToggle = isRunning || isPreliminaryOutput ? undefined : () => setIsOpen((v) => !v)

  const StatusIcon = isDone
    ? (isError ? IconXboxX : IconCircleCheck)
    : IconLoader

  return (
    <div
      className={cn(
        "rounded-lg border border-border/50 bg-muted/30 w-[90%]",
        hasContent && !isRunning && "cursor-pointer select-none",
        className
      )}
      onClick={hasContent && !isRunning ? collapsibleToggle : undefined}
      {...props}
    >
      <div className={cn("flex items-center gap-2 px-3 py-2 hover:bg-muted/50", isOpen && "border-b border-border/50")}>
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

      {hasContent && (
        <Collapsible open={collapsibleOpen} onOpenChange={isRunning ? undefined : setIsOpen}>
          <CollapsibleContent>
            <div className="px-3 pb-2.5 space-y-2">
              {isPreliminaryOutput && resultText && (
                <div
                  ref={scrollRef}
                  className={cn(
                    "overflow-y-auto rounded-md bg-background/60 px-2.5 py-2 text-xs leading-relaxed max-h-52",
                    "font-mono text-muted-foreground/70 whitespace-pre-wrap"
                  )}
                >
                  {resultText}
                  <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-muted-foreground/50 animate-pulse align-text-bottom" />
                </div>
              )}
              {!isPreliminaryOutput && editDiff && (
                <DiffViewer
                  oldCode={editDiff.oldCode}
                  newCode={editDiff.newCode}
                  layout="unified"
                  oldTitle="原始"
                  newTitle="修改后"
                  className="max-h-52 overflow-y-auto rounded-md"
                />
              )}
              {!isPreliminaryOutput && !editDiff && displayContent && (
                <div className="relative overflow-y-auto rounded-md bg-background/60 max-h-52">
                  <CodeHighlight
                    code={displayContent}
                    language={detectedLang}
                  />
                  {isStreaming && (
                    <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-muted-foreground/50 animate-pulse align-text-bottom" />
                  )}
                  {isOverflowing && !isRunning && !isOpen && (
                    <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-6 bg-gradient-to-t from-background/60 to-transparent" />
                  )}
                </div>
              )}
              {!isPreliminaryOutput && hasResult && (
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
