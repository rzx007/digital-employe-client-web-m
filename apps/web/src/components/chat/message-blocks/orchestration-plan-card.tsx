"use client"

import * as React from "react"
import { IconX } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { CronPreviewBadge } from "./cron-preview-badge"

export interface OrchestrationTaskProgress {
  task_id: number
  employee_id?: number
  employee_name: string
  task_name: string
  status: "pending" | "running" | "success" | "failed"
  conversation_id?: number
  cron?: string | null
  execute_mode: string
}

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

export function OrchestrationPlanCard({
  planId,
  summary,
  tasks,
  onConfirm,
  onCancel,
  isExecuting,
  className,
}: {
  planId: number
  summary: string
  tasks: OrchestrationTaskProgress[]
  onConfirm?: (planId: number) => void
  onCancel?: (planId: number) => void
  isExecuting?: boolean
  className?: string
}) {
  const [confirming, setConfirming] = React.useState(false)

  const handleConfirm = React.useCallback(async () => {
    setConfirming(true)
    try {
      await onConfirm?.(planId)
    } finally {
      setConfirming(false)
    }
  }, [planId, onConfirm])

  return (
    <div
      className={cn(
        "w-full max-w-lg rounded-xl border bg-card p-4 shadow-sm",
        className
      )}
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">编排计划</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{summary}</p>
        </div>
        <span className="ml-2 shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
          {tasks.length} 个子任务
        </span>
      </div>

      <div className="space-y-1.5">
        {tasks.map((task, i) => (
          <div
            key={task.task_id || i}
            className={cn(
              "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs",
              task.status === "running" && "bg-blue-50 dark:bg-blue-950/30",
              task.status === "success" && "bg-green-50 dark:bg-green-950/30",
              task.status === "failed" && "bg-red-50 dark:bg-red-950/30"
            )}
          >
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                task.status === "pending" && "bg-muted-foreground/40",
                task.status === "running" && "bg-blue-500",
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
            <CronPreviewBadge cron={task.cron} />
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

      {!isExecuting && (
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs"
            onClick={handleConfirm}
            disabled={confirming}
          >
            {confirming ? "确认中..." : "确认执行"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => onCancel?.(planId)}
          >
            <IconX className="mr-1 size-3" />
            取消
          </Button>
        </div>
      )}
    </div>
  )
}
