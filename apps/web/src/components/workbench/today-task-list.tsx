import { useMemo } from "react"
import { IconClock } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Skeleton } from "@workspace/ui/components/skeleton"
import type { TaskExecution } from "@/types/schedule-monitor"
import { TaskStatusBadge } from "./task-status-badge"

interface TodayTaskListProps {
  executions: TaskExecution[]
  isLoading?: boolean
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
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
  const sorted = useMemo(() => {
    return [...executions].sort((a, b) => {
      if (a.run_status === "running" && b.run_status !== "running") return -1
      if (b.run_status === "running" && a.run_status !== "running") return 1
      return new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
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
        {sorted.map((exec) => (
          <div
            key={exec.id}
            className={cn(
              "flex items-center gap-2 rounded-md border p-2 transition-colors",
              exec.run_status === "running" && "border-blue-300 bg-blue-50/50 dark:bg-blue-950/20"
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-xs font-medium">{exec.task_name}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{exec.employee_name}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-0.5">
                  <IconClock className="size-2.5" />
                  {formatTime(exec.started_at)}
                </span>
                {exec.duration_ms != null && (
                  <span>{formatDuration(exec.duration_ms)}</span>
                )}
              </div>
            </div>
            <TaskStatusBadge status={exec.run_status} />
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}
