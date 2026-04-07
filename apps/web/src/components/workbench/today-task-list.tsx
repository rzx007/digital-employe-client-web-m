import { useMemo } from "react"
import { IconClock } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Skeleton } from "@workspace/ui/components/skeleton"
import type { TaskRun } from "@/types/schedule-monitor"
import { TaskStatusBadge } from "./task-status-badge"

interface TodayTaskListProps {
  taskRuns: TaskRun[]
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

export function TodayTaskList({ taskRuns, isLoading }: TodayTaskListProps) {
  const sortedRuns = useMemo(() => {
    return [...taskRuns].sort((a, b) => {
      // Running tasks first, then by trigger time desc
      if (a.status === "running" && b.status !== "running") return -1
      if (b.status === "running" && a.status !== "running") return 1
      return new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime()
    })
  }, [taskRuns])

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (taskRuns.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-muted-foreground">
        今日暂无任务执行
      </div>
    )
  }

  return (
    <ScrollArea className="h-[200px]">
      <div className="space-y-1.5">
        {sortedRuns.map((run) => (
          <div
            key={run.id}
            className={cn(
              "flex items-center gap-2 rounded-md border p-2 transition-colors",
              run.status === "running" && "border-blue-300 bg-blue-50/50 dark:bg-blue-950/20"
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{run.taskName}</div>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-0.5">
                  <IconClock className="size-2.5" />
                  {formatTime(run.triggeredAt)}
                </span>
                {run.duration != null && (
                  <span>{formatDuration(run.duration)}</span>
                )}
              </div>
            </div>
            <TaskStatusBadge status={run.status} />
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}
