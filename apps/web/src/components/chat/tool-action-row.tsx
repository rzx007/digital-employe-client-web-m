import { cn } from "@workspace/ui/lib/utils"
import {
  IconCircleCheck,
  IconChevronRight,
  IconChevronDown,
  IconListCheck,
  IconLoader,
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
import {
  getDisplayContent,
  getEditDiff,
  getToolIcon,
  getTodos,
  countCompleted,
  TodoListBlock,
} from "./tool-shared"

import type { ToolCallSummary } from "@/lib/chat/tool-summarizer"

const stateIconMap: Record<string, typeof IconCircleCheck> = {
  "output-available": IconCircleCheck,
  "output-error": IconXboxX,
}

export type ToolActionRowProps = ComponentProps<"div"> & {
  summary: ToolCallSummary
  state: string
  resultText?: string | null
  input?: unknown
  preliminary?: boolean
}

export function ToolActionRow({
  summary,
  state,
  resultText,
  input,
  preliminary,
  className,
  ...props
}: ToolActionRowProps) {
  const StatusIcon = stateIconMap[state] ?? IconLoader
  const ToolIcon = getToolIcon(summary.toolName)
  const isError = state === "output-error"
  const isDone = (state === "output-available" && !preliminary) || state === "output-error"
  const isRunning = !isDone
  const isStreaming = state === "input-streaming"
  const isPreliminaryOutput = state === "output-available" && preliminary === true

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

  const isWriteTodos = summary.toolName === "write_todos"
  const todos = isWriteTodos ? getTodos(input, resultText) : null
  const hasTodos = todos && todos.length > 0

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
    if (isDone && resultText && !didAutoCollapse.current) {
      didAutoCollapse.current = true
      setIsOpen(false)
    }
  }, [isDone, resultText])

  useEffect(() => {
    if ((isRunning || isPreliminaryOutput) && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [displayContent, isRunning, isPreliminaryOutput, resultText])

  const IconChevron = useMemo(() => {
    return isOpen ? IconChevronDown : IconChevronRight
  }, [isOpen])

  const collapsibleOpen = isRunning || isPreliminaryOutput ? true : isOpen
  const collapsibleToggle = isRunning || isPreliminaryOutput ? undefined : () => setIsOpen((v) => !v)

  if (isWriteTodos && hasTodos) {
    const completed = countCompleted(todos!)
    const total = todos!.length
    const allDone = completed === total

    return (
      <div
        className={cn(
          "not-prose rounded-lg border border-border/50 bg-muted/30 w-[90%]",
          className
        )}
        {...props}
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <IconListCheck className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-xs text-foreground font-thin">
            {allDone
              ? `${total} 项任务已完成`
              : `任务规划（${completed}/${total}）`}
          </span>
          <span className="shrink-0 text-xs font-mono text-muted-foreground/60 tabular-nums">
            write_todos
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
        <TodoListBlock todos={todos!} />
      </div>
    )
  }

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
      <div className={cn("group/tool-action-row flex items-center gap-2 px-3 py-2 hover:bg-muted/50", isOpen && "border-b border-border/50")}>
        <ToolIcon className="size-4 shrink-0 text-muted-foreground group-hover/tool-action-row:hidden" />
        {hasContent && !isRunning && (
          <IconChevron className="hidden size-4 shrink-0 text-muted-foreground/60 group-hover/tool-action-row:block" />
        )}
        {!(hasContent && !isRunning) && <span className="hidden size-4 shrink-0 group-hover/tool-action-row:block" />}
        <span className="flex-1 truncate text-xs text-foreground font-thin">
          {summary.label}
        </span>
        <span className="shrink-0 text-xs font-mono text-muted-foreground/60 tabular-nums">
          {summary.toolName}
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
