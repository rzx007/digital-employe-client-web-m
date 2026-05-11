import { cn } from "@workspace/ui/lib/utils"
import {
  IconChevronDown,
  IconCircle,
  IconCircleCheck,
  IconCode,
  IconFileDescription,
  IconFolder,
  IconListCheck,
  IconLoader,
  IconPencil,
  IconPlayerPlay,
} from "@tabler/icons-react"
import { useState } from "react"

// ── Display content extraction ──────────────────────────

const CONTENT_TOOLS = new Set(["write_file", "edit_file"])
const COMMAND_TOOLS = new Set(["execute"])

export function getDisplayContent(
  input: unknown,
  toolName: string
): string | null {
  if (!input || typeof input !== "object") return null
  const obj = input as Record<string, unknown>
  if (CONTENT_TOOLS.has(toolName)) {
    if (toolName === "edit_file") {
      return typeof obj.new_string === "string" && obj.new_string
        ? obj.new_string
        : null
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

export function getEditDiff(
  input: unknown
): { oldCode: string; newCode: string } | null {
  if (!input || typeof input !== "object") return null
  const obj = input as Record<string, unknown>
  const oldCode = typeof obj.old_string === "string" ? obj.old_string : null
  const newCode = typeof obj.new_string === "string" ? obj.new_string : null
  return oldCode != null && newCode != null ? { oldCode, newCode } : null
}

// ── Icon maps ───────────────────────────────────────────

export const TOOL_ICON_MAP: Record<string, typeof IconFileDescription> = {
  read_file: IconFileDescription,
  write_file: IconPencil,
  edit_file: IconPencil,
  execute: IconPlayerPlay,
  ls: IconFolder,
  write_todos: IconListCheck,
}

export function getToolIcon(toolName: string): typeof IconFileDescription {
  return TOOL_ICON_MAP[toolName] ?? IconCode
}

// ── Todo types & helpers ────────────────────────────────

export interface TodoItem {
  content: string
  status: string
}

const PREVIEW_COUNT = 3

export function extractTodosFromInput(input: unknown): TodoItem[] | null {
  if (!input || typeof input !== "object") return null
  const todos = (input as Record<string, unknown>).todos
  if (!Array.isArray(todos) || todos.length === 0) return null
  return todos.map((t: Record<string, unknown>) => ({
    content:
      typeof t.content === "string" ? t.content : String(t.content ?? ""),
    status: typeof t.status === "string" ? t.status : "pending",
  }))
}

export function extractTodosFromOutputText(text: string): TodoItem[] | null {
  const match = text.match(/Updated todo list to\s*(\[[\s\S]*\])/)
  if (!match) return null
  try {
    let jsonStr = match[1]
    jsonStr = jsonStr.replace(/'/g, '"')
    const parsed = JSON.parse(jsonStr)
    if (!Array.isArray(parsed)) return null
    return parsed.map((t: Record<string, unknown>) => ({
      content:
        typeof t.content === "string" ? t.content : String(t.content ?? ""),
      status: typeof t.status === "string" ? t.status : "pending",
    }))
  } catch {
    return null
  }
}

export function getTodos(
  input: unknown,
  resultText: string | null | undefined
): TodoItem[] | null {
  return (
    extractTodosFromInput(input) ??
    (resultText ? extractTodosFromOutputText(resultText) : null)
  )
}

export function countCompleted(todos: TodoItem[]): number {
  return todos.filter((t) => t.status === "completed").length
}

// ── TodoListBlock ───────────────────────────────────────

export function TodoListBlock({ todos }: { todos: TodoItem[] }) {
  const completed = countCompleted(todos)
  const total = todos.length
  const allDone = completed === total
  const needsCollapse = todos.length > PREVIEW_COUNT
  const [expanded, setExpanded] = useState(false)

  const visibleTodos =
    needsCollapse && !expanded ? todos.slice(0, PREVIEW_COUNT) : todos

  return (
    <div className="px-3 pb-2.5">
      <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium">
          {allDone ? `${total} 项任务已完成` : `${completed}/${total} 已完成`}
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
          className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
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
          {expanded ? "收起" : `还有 ${todos.length - PREVIEW_COUNT} 项`}
        </button>
      )}
    </div>
  )
}
