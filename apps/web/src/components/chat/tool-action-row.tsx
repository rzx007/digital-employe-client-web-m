import { cn } from "@workspace/ui/lib/utils"
import {
  IconCircleCheck,
  IconCircle,
  IconCode,
  IconChevronRight,
  IconChevronDown,
  IconFileDescription,
  IconFolder,
  IconListCheck,
  IconLoader,
  IconPencil,
  IconPlayerPlay,
  IconXboxX,
} from "@tabler/icons-react"
import type { ComponentProps } from "react"
import { useRef, useState, useLayoutEffect, useMemo } from "react"
import {
  Collapsible,
  CollapsibleContent,
} from "@workspace/ui/components/collapsible"

import type { ToolCallSummary } from "@/lib/chat/tool-summarizer"

// ── Todo types ──────────────────────────────────────────

export interface TodoItem {
  content: string
  status: string
}

const PREVIEW_COUNT = 3

function extractTodosFromInput(input: unknown): TodoItem[] | null {
  if (!input || typeof input !== "object") return null
  const todos = (input as Record<string, unknown>).todos
  if (!Array.isArray(todos) || todos.length === 0) return null
  return todos.map((t: Record<string, unknown>) => ({
    content: typeof t.content === "string" ? t.content : String(t.content ?? ""),
    status: typeof t.status === "string" ? t.status : "pending",
  }))
}

function extractTodosFromOutputText(text: string): TodoItem[] | null {
  const match = text.match(/Updated todo list to\s*(\[[\s\S]*\])/)
  if (!match) return null
  try {
    let jsonStr = match[1]
    jsonStr = jsonStr.replace(/'/g, '"')
    const parsed = JSON.parse(jsonStr)
    if (!Array.isArray(parsed)) return null
    return parsed.map((t: Record<string, unknown>) => ({
      content: typeof t.content === "string" ? t.content : String(t.content ?? ""),
      status: typeof t.status === "string" ? t.status : "pending",
    }))
  } catch {
    return null
  }
}

function getTodos(input: unknown, resultText: string | null | undefined): TodoItem[] | null {
  return extractTodosFromInput(input) ?? (resultText ? extractTodosFromOutputText(resultText) : null)
}

function countCompleted(todos: TodoItem[]): number {
  return todos.filter((t) => t.status === "completed").length
}

// ── Icon maps ───────────────────────────────────────────

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

// ── TodoListBlock ───────────────────────────────────────

function TodoListBlock({
  todos,
}: {
  todos: TodoItem[]
}) {
  const completed = countCompleted(todos)
  const total = todos.length
  const allDone = completed === total
  const needsCollapse = todos.length > PREVIEW_COUNT
  const [expanded, setExpanded] = useState(false)

  const visibleTodos = needsCollapse && !expanded
    ? todos.slice(0, PREVIEW_COUNT)
    : todos

  return (
    <div className="px-3 pb-2.5">
      <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium">
          {allDone
            ? `${total} 项任务已完成`
            : `${completed}/${total} 已完成`}
        </span>
      </div>
      <div className="space-y-1">
        {visibleTodos.map((todo, idx) => (
          <div key={idx} className="flex items-start gap-2 text-xs">
            {todo.status === "completed" ? (
              <IconCircleCheck className="mt-0.5 size-3.5 shrink-0 text-green-600/70" />
            ) : todo.status === "in_progress" ? (
              <IconLoader className="mt-0.5 size-3.5 shrink-0 text-amber-500/70" />
            ) : (
              <IconCircle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/40" />
            )}
            <span
              className={cn(
                "leading-relaxed",
                todo.status === "completed"
                  ? "text-muted-foreground/60 line-through"
                  : "text-foreground/80"
              )}
            >
              {todo.content}
            </span>
          </div>
        ))}
      </div>
      {needsCollapse && (
        <button
          type="button"
          className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
        >
          <IconChevronDown
            className={cn(
              "size-3 transition-transform",
              expanded && "rotate-180"
            )}
          />
          {expanded
            ? "收起"
            : `还有 ${todos.length - PREVIEW_COUNT} 项`}
        </button>
      )}
    </div>
  )
}

// ── ToolActionRow ───────────────────────────────────────

export type ToolActionRowProps = ComponentProps<"div"> & {
  summary: ToolCallSummary
  state: string
  resultText?: string | null
  input?: unknown
}

export function ToolActionRow({
  summary,
  state,
  resultText,
  input,
  className,
  ...props
}: ToolActionRowProps) {
  const StatusIcon = stateIconMap[state] ?? IconLoader
  const ToolIcon = getToolIcon(summary.toolName)
  const isError = state === "output-error"
  const isDone = state === "output-available" || state === "output-error"
  const isRunning = !isDone
  const hasResult = !!resultText

  const isWriteTodos = summary.toolName === "write_todos"
  const todos = isWriteTodos ? getTodos(input, resultText) : null
  const hasTodos = todos && todos.length > 0

  const scrollRef = useRef<HTMLDivElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setIsOverflowing(el.scrollHeight > el.clientHeight)
  }, [resultText])

  const IconChevron = useMemo(() => {
    return isOpen ? IconChevronDown : IconChevronRight
  }, [isOpen])

  // write_todos with structured data: dedicated todo list UI
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

  // Generic tool: existing behavior
  return (
    <div
      className={cn(
        "rounded-lg border border-border/50 bg-muted/30 w-[90%]",
        hasResult && "cursor-pointer select-none",
        className
      )}
      onClick={hasResult ? () => setIsOpen((v) => !v) : undefined}
      {...props}
    >
      <div className={cn("group/tool-action-row flex items-center gap-2 px-3 py-2 hover:bg-muted/50", isOpen && "border-b border-border/50")}>
        <ToolIcon className="size-4 shrink-0 text-muted-foreground group-hover/tool-action-row:hidden" />
        {hasResult && (
          <IconChevron className="hidden size-4 shrink-0 text-muted-foreground/60 group-hover/tool-action-row:block" />
        )}
        {!hasResult && <span className="hidden size-4 shrink-0 group-hover/tool-action-row:block" />}
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

      {hasResult && (
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleContent
            className="data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
          >
            <div className="relative mt-1.5">
              <div
                ref={scrollRef}
                className={cn(
                  "overflow-y-auto rounded-md bg-background/60 px-2.5 py-2 text-xs leading-relaxed max-h-52",
                  isError
                    ? "text-destructive/70"
                    : "text-muted-foreground/70"
                )}
              >
                {resultText}
              </div>
              {isOverflowing && !isOpen && (
                <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-6 bg-gradient-to-t from-background/60 to-transparent" />
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}
