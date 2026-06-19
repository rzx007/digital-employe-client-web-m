// NOTE(2026-06-19): 计划卡确认态已改为静态提示，本组件暂无引用方（进度统一由右侧协作流程 DAG 展示）。
import { cn } from "@workspace/ui/lib/utils"
import { useChatStore } from "@/stores/chat-store"
import type { OrchestrationTaskProgress } from "./orchestration-plan-card"

const STATUS_LABEL: Record<string, string> = {
  pending: "待执行",
  running: "执行中",
  success: "成功",
  failed: "失败",
}

const STATUS_CLASS: Record<string, string> = {
  pending: "text-muted-foreground",
  running: "text-blue-500",
  success: "text-green-500",
  failed: "text-red-500",
}

function humanCron(cron: string | null | undefined): string | null {
  if (!cron) return null
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return cron
  const [min, hour, day, month, week] = parts
  if (week !== "*") {
    const days = ["日", "一", "二", "三", "四", "五", "六"]
    const dayNames = week
      .split(",")
      .map((d) => days[Number(d)] ?? d)
      .join("、")
    return `每周${dayNames} ${hour}:${min}`
  }
  if (day !== "*") return `每月${day}日 ${hour}:${min}`
  return `每天 ${hour}:${min}`
}

export function TaskProgressBar({
  planId,
  summary,
  total,
  completed,
  tasks,
  className,
}: {
  planId: number
  summary: string
  total: number
  completed: number
  tasks: OrchestrationTaskProgress[]
  className?: string
}) {
  const setSelectedContactId = useChatStore((s) => s.setSelectedContactId)
  const setSelectedConversationId = useChatStore(
    (s) => s.setSelectedConversationId
  )

  const pct = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div
      className={cn(
        "w-full max-w-lg rounded-xl border bg-card p-4 shadow-sm",
        className
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold">执行中</p>
        <span className="text-xs text-muted-foreground">
          {completed}/{total} ({pct}%)
        </span>
      </div>

      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-blue-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="space-y-1">
        {tasks.map((task) => (
          <div
            key={task.task_id}
            className={cn(
              "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs",
              task.status === "running" && "bg-blue-50 dark:bg-blue-950/30",
              task.status === "success" && "bg-green-50 dark:bg-green-950/30",
              task.status === "failed" && "bg-red-50 dark:bg-red-950/30"
            )}
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                task.status === "pending" && "bg-muted-foreground/40",
                task.status === "running" && "animate-pulse bg-blue-500",
                task.status === "success" && "bg-green-500",
                task.status === "failed" && "bg-red-500"
              )}
            />
            <span className="min-w-0 flex-1 truncate font-medium">
              {task.task_name}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {task.employee_name}
            </span>
            {task.execute_mode === "scheduled" && (
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {humanCron(task.cron)}
              </span>
            )}
            {task.conversation_id ? (
              <button
                type="button"
                className="shrink-0 text-[10px] text-blue-500 hover:underline"
                onClick={() => {
                  setSelectedContactId(String(task.conversation_id))
                }}
              >
                查看
              </button>
            ) : null}
            <span
              className={cn(
                "shrink-0 text-[10px]",
                STATUS_CLASS[task.status] || ""
              )}
            >
              {STATUS_LABEL[task.status] || task.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
