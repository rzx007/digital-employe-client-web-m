import { cn } from "@workspace/ui/lib/utils"
import {
  IconCircleCheck,
  IconCode,
  IconListCheck,
  IconLoader,
  IconXboxX,
} from "@tabler/icons-react"
import type { ComponentProps } from "react"
import {
  useRef,
  useState,
  useLayoutEffect,
  useMemo,
  useEffect,
  memo,
} from "react"
import {
  Collapsible,
  CollapsibleContent,
} from "@workspace/ui/components/collapsible"
import { DiffViewer } from "@workspace/ui/components/diff-viewer"
import { CodeHighlight, detectLanguage } from "../shared/code-highlight"
import {
  getDisplayContent,
  getEditDiff,
  getTodos,
  countCompleted,
  TodoListBlock,
  TOOL_ICON_MAP,
} from "./tool-shared"

import {
  getSimpleLabel,
  type ToolCallSummary,
} from "@/lib/chat/tool-summarizer"

export type ToolActionRowSimpleProps = ComponentProps<"div"> & {
  summary: ToolCallSummary
  state: string
  resultText?: string | null
  input?: unknown
  preliminary?: boolean
}

function ToolActionRowSimpleInner({
  summary,
  state,
  resultText,
  input,
  preliminary,
  className,
  ...props
}: ToolActionRowSimpleProps) {
  const ToolIcon = TOOL_ICON_MAP[summary.toolName] ?? IconCode
  const isError = state === "output-error"
  const isDone =
    (state === "output-available" && !preliminary) || state === "output-error"
  const isRunning = !isDone
  const isStreaming = state === "input-streaming"
  const isPreliminaryOutput =
    state === "output-available" && preliminary === true

  const labelState = isError ? "error" : isDone ? "done" : "running"
  const label = getSimpleLabel(summary.toolName, labelState)

  const displayContent = useMemo(
    () => getDisplayContent(input, summary.toolName),
    [input, summary.toolName]
  )
  const editDiff = useMemo(
    () => (summary.toolName === "edit_file" ? getEditDiff(input) : null),
    [summary.toolName, input]
  )
  const detectedLang = useMemo(
    () =>
      detectLanguage(
        (input as Record<string, unknown> | null)?.file_path as string
      ),
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
      queueMicrotask(() => setIsOpen(true))
    }
  }, [isStreaming, displayContent, isOpen])

  useEffect(() => {
    if (isPreliminaryOutput && !isOpen) {
      queueMicrotask(() => setIsOpen(true))
    }
  }, [isPreliminaryOutput, isOpen])

  useEffect(() => {
    if (isDone && (resultText || displayContent) && !didAutoCollapse.current) {
      didAutoCollapse.current = true
      queueMicrotask(() => setIsOpen(false))
    }
  }, [isDone, resultText, displayContent])

  useEffect(() => {
    if ((isRunning || isPreliminaryOutput) && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [displayContent, isRunning, isPreliminaryOutput, resultText])

  const collapsibleOpen = isRunning || isPreliminaryOutput ? true : isOpen
  const collapsibleToggle =
    isRunning || isPreliminaryOutput ? undefined : () => setIsOpen((v) => !v)

  const StatusIcon = isDone
    ? isError
      ? IconXboxX
      : IconCircleCheck
    : IconLoader

  if (isWriteTodos && hasTodos) {
    const completed = countCompleted(todos!)
    const total = todos!.length
    const allDone = completed === total

    return (
      <div
        className={cn(
          "w-[90%] rounded-lg border border-border/50 bg-muted/30",
          className
        )}
        {...props}
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <IconListCheck className="size-4 shrink-0 text-muted-foreground" />
          <span
            className={cn(
              "flex-1 truncate text-xs font-thin",
              isDone && !isError && "text-muted-foreground",
              isError && "text-destructive/80",
              !isDone && "text-foreground"
            )}
          >
            {allDone
              ? `${total} 项任务已完成`
              : `任务规划（${completed}/${total}）`}
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
        <TodoListBlock todos={todos!} />
      </div>
    )
  }

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
          "flex items-center gap-2 px-3 py-2 hover:bg-muted/50",
          isOpen && "border-b border-border/50"
        )}
      >
        <ToolIcon className="size-4 shrink-0 text-muted-foreground" />
        <span
          className={cn(
            "flex-1 truncate text-xs font-thin",
            isDone && !isError && "text-muted-foreground",
            isError && "text-destructive/80",
            !isDone && "text-foreground"
          )}
        >
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
        <Collapsible
          open={collapsibleOpen}
          onOpenChange={isRunning ? undefined : setIsOpen}
        >
          <CollapsibleContent>
            <div className="space-y-2 px-3 pb-2.5">
              {isPreliminaryOutput && resultText && (
                <div
                  ref={scrollRef}
                  className={cn(
                    "max-h-52 overflow-y-auto rounded-md bg-background/60 px-2.5 py-2 text-xs leading-relaxed",
                    "font-mono whitespace-pre-wrap text-muted-foreground/70"
                  )}
                >
                  {resultText}
                  <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-muted-foreground/50 align-text-bottom" />
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
                <div className="relative max-h-52 overflow-y-auto rounded-md bg-background/60">
                  <CodeHighlight
                    code={displayContent}
                    language={detectedLang}
                  />
                  {isStreaming && (
                    <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-muted-foreground/50 align-text-bottom" />
                  )}
                  {isOverflowing && !isRunning && !isOpen && (
                    <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-6 bg-gradient-to-t from-background/60 to-transparent" />
                  )}
                </div>
              )}
              {!isPreliminaryOutput && hasResult && (
                <div
                  className={cn(
                    "max-h-52 overflow-y-auto rounded-md bg-background/60 px-2.5 py-2 text-xs leading-relaxed",
                    isError
                      ? "text-destructive/70"
                      : "font-mono whitespace-pre-wrap text-muted-foreground/70"
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

export const ToolActionRowSimple = memo(ToolActionRowSimpleInner)
