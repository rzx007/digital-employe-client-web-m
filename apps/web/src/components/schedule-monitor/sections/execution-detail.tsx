import { useState } from "react"
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import { Badge } from "@workspace/ui/components/badge"
import type { TaskRun, TaskRunStatus } from "@/types/schedule-monitor"
import { formatTaskDuration } from "@/lib/mock-data/schedule-monitor"
import { ScrollArea } from "@workspace/ui/components/scroll-area"

const STATUS_CONFIG: Record<
  TaskRunStatus,
  { label: string; className: string }
> = {
  success: {
    label: "成功",
    className:
      "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  },
  failed: {
    label: "失败",
    className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  },
  pending: {
    label: "待执行",
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  },
  running: {
    label: "执行中",
    className:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  },
  timeout: {
    label: "超时",
    className:
      "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400",
  },
  stuck: {
    label: "卡死",
    className:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400",
  },
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}

function TaskRunRow({ run }: { run: TaskRun }) {
  const [expanded, setExpanded] = useState(false)
  const config = STATUS_CONFIG[run.status]

  return (
    <div className="rounded-md border">
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50"
        )}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <IconChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {run.taskName}
        </span>
        <Badge
          variant="outline"
          className={cn("shrink-0 px-1.5 py-0 text-[10px]", config.className)}
        >
          {config.label}
        </Badge>
        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
          {formatTime(run.triggeredAt)}
        </span>
        <span
          className={cn(
            "shrink-0 text-[10px] tabular-nums",
            run.duration != null && run.duration >= 30000
              ? "text-red-500"
              : "text-muted-foreground"
          )}
        >
          {formatTaskDuration(run.duration)}
        </span>
      </button>

      {expanded && (
        <div className="space-y-1.5 border-t px-3 py-2">
          <div className="flex gap-4 text-[10px]">
            <div>
              <span className="text-muted-foreground">触发时间: </span>
              <span>{formatTime(run.triggeredAt)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">耗时: </span>
              <span
                className={
                  run.duration != null && run.duration >= 30000
                    ? "text-red-500"
                    : ""
                }
              >
                {formatTaskDuration(run.duration)}
                {run.duration != null && run.duration >= 30000 && " (超时)"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">排期: </span>
              <span>{run.cronDescription}</span>
            </div>
          </div>

          {run.log && (
            <div className="rounded bg-muted/50 p-2">
              <p className="mb-1 text-[10px] font-medium text-muted-foreground">
                执行日志
              </p>
              <pre className="text-[10px] leading-relaxed break-all whitespace-pre-wrap text-foreground/80">
                {run.log}
              </pre>
            </div>
          )}

          {run.result && (
            <div className="rounded bg-muted/50 p-2">
              <p className="mb-1 text-[10px] font-medium text-muted-foreground">
                返回结果
              </p>
              <p className="text-[10px] leading-relaxed text-foreground/80">
                {run.result}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ExecutionDetail({ runs }: { runs: TaskRun[] }) {
  if (runs.length === 0) {
    return (
      <div className="rounded-lg border p-4">
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">
          执行详情
        </h3>
        <p className="py-4 text-center text-xs text-muted-foreground">
          今日暂无执行记录
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border p-4">
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">
        执行详情
      </h3>
      <ScrollArea className="max-h-[380px] space-y-1 overflow-auto">
        {runs.map((run) => (
          <TaskRunRow key={run.id} run={run} />
        ))}
      </ScrollArea>
    </div>
  )
}
