import { useCallback, useMemo } from "react"
import { IconClock } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Skeleton } from "@workspace/ui/components/skeleton"
import type { TodayTask } from "@/types/schedule-monitor"
import { TaskStatusBadge } from "./task-status-badge"
import { useChatStore } from "@/stores/chat-store"

interface TodayTaskListProps {
  executions: TodayTask[]
  isLoading?: boolean
}

function formatTime(dateStr: string): string {
  if (!dateStr.trim()) return "--"
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return "--"
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "-"
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

export function TodayTaskList({ executions, isLoading }: TodayTaskListProps) {
  const selectConversation = useChatStore((s) => s.selectConversation)
  const setActiveTab = useChatStore((s) => s.setActiveTab)

  const openTaskConversation = useCallback(
    (task: TodayTask) => {
      if (task.conversation_id == null) return
      selectConversation(String(task.employee_id), String(task.conversation_id))
      setActiveTab("chat")
    },
    [selectConversation, setActiveTab]
  )
  const sorted = useMemo(() => {
    return [...executions].sort((a, b) => {
      if (a.run_status === "running" && b.run_status !== "running") return -1
      if (b.run_status === "running" && a.run_status !== "running") return 1
      const at = a.started_at || a.planned_at || ""
      const bt = b.started_at || b.planned_at || ""
      return bt.localeCompare(at)
    })
  }, [executions])

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (executions.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-muted-foreground">
        今日暂无任务执行
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-1.5">
        {sorted.map((task) => {
          const rowKey =
            task.task_id + (task.execution_id ? `-${task.execution_id}` : "")
          const canOpenChat = task.conversation_id != null
          const rowClassName = cn(
            "flex items-center gap-2 rounded-md border p-2 transition-colors",
            task.run_status === "running" &&
              "border-blue-300 bg-blue-50/50 dark:bg-blue-950/20",
            canOpenChat && "cursor-pointer hover:bg-muted/40",
            !canOpenChat && "cursor-default"
          )

          const body = (
            <>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-medium">
                    {task.task_name}
                  </span>
                  <span className="shrink-0 rounded bg-muted/70 px-1 py-px text-[10px] font-semibold text-foreground">
                    {task.employee_name}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-0.5">
                    <IconClock className="size-2.5" />
                    {formatTime(task.started_at || task.planned_at || "")}
                  </span>
                  {task.duration_ms != null && (
                    <span>{formatDuration(task.duration_ms)}</span>
                  )}
                </div>
              </div>
              <TaskStatusBadge status={task.run_status} />
            </>
          )

          if (canOpenChat) {
            return (
              <button
                key={rowKey}
                type="button"
                className={cn(rowClassName, "w-full text-left")}
                onClick={() => openTaskConversation(task)}
              >
                {body}
              </button>
            )
          }

          return (
            <div key={rowKey} className={rowClassName}>
              {body}
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}
