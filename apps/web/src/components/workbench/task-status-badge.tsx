import { cn } from "@workspace/ui/lib/utils"
import type { TaskStatus } from "@/types/workbench"

interface TaskStatusBadgeProps {
  status: TaskStatus
  className?: string
}

const STATUS_CONFIG: Record<
  TaskStatus,
  { label: string; className: string; dotClassName: string }
> = {
  success: {
    label: "成功",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    dotClassName: "bg-emerald-500",
  },
  failed: {
    label: "失败",
    className: "bg-red-500/10 text-red-600 dark:text-red-400",
    dotClassName: "bg-red-500",
  },
  pending: {
    label: "等待",
    className: "bg-muted text-muted-foreground",
    dotClassName: "bg-muted-foreground",
  },
  queued: {
    label: "排队中",
    className: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
    dotClassName: "bg-slate-500",
  },
  running: {
    label: "运行中",
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    dotClassName: "bg-blue-500 animate-pulse",
  },
  timeout: {
    label: "超时",
    className: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    dotClassName: "bg-orange-500",
  },
  stuck: {
    label: "卡住",
    className: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
    dotClassName: "bg-purple-500",
  },
  cancelled: {
    label: "已取消",
    className: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
    dotClassName: "bg-slate-500",
  },
  superseded: {
    label: "已打回",
    className: "bg-gray-500/10 text-gray-500 dark:text-gray-400",
    dotClassName: "bg-gray-400",
  },
}

export function TaskStatusBadge({ status, className }: TaskStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        config.className,
        className
      )}
    >
      <span className={cn("size-1.5 rounded-full", config.dotClassName)} />
      {config.label}
    </span>
  )
}
