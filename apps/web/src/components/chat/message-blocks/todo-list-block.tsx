import { cn } from "@workspace/ui/lib/utils"
import {
  IconChevronDown,
  IconCircle,
  IconCircleCheck,
  IconLoader,
} from "@tabler/icons-react"
import { useState } from "react"
import { countCompleted, type TodoItem } from "./tool-shared"

const PREVIEW_COUNT = 3

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
