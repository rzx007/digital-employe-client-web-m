import { cn } from "@workspace/ui/lib/utils"
import {
  IconCircleCheck,
  IconListCheck,
  IconLoader,
  IconXboxX,
} from "@tabler/icons-react"
import type { ComponentProps } from "react"
import { memo } from "react"
import type { ToolGroupItem } from "@/lib/chat/message-classifier"
import { countCompleted, type TodoItem } from "./tool-shared"
import { TodoListBlock } from "./todo-list-block"

const stateIconMap: Record<string, typeof IconCircleCheck> = {
  "output-available": IconCircleCheck,
  "output-error": IconXboxX,
}

export type TodoPlanBlockProps = ComponentProps<"div"> & {
  tool: ToolGroupItem
  todos: TodoItem[]
  sticky?: boolean
}

function TodoPlanBlockInner({
  tool,
  todos,
  sticky = false,
  className,
  ...props
}: TodoPlanBlockProps) {
  const state = tool.state
  const preliminary = tool.preliminary
  const StatusIcon = stateIconMap[state] ?? IconLoader
  const isError = state === "output-error"
  const isDone =
    (state === "output-available" && !preliminary) || state === "output-error"
  const isRunning = !isDone

  const completed = countCompleted(todos)
  const total = todos.length
  const allDone = completed === total

  return (
    <div
      className={cn(
        "not-prose w-[90%]",
        sticky &&
          "sticky top-0 z-20 bg-background/95 py-1 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80",
        className
      )}
      {...props}
    >
      <div
        className={cn(
          "rounded-lg border border-border/50 bg-muted/30",
          sticky && "shadow-sm"
        )}
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <IconListCheck className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-xs font-thin text-foreground">
            {allDone
              ? `${total} 项任务已完成`
              : `任务规划（${completed}/${total}）`}
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
        <TodoListBlock todos={todos} />
      </div>
    </div>
  )
}

export const TodoPlanBlock = memo(TodoPlanBlockInner)
