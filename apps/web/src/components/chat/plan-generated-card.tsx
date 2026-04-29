"use client"

import * as React from "react"
import { cn } from "@workspace/ui/lib/utils"
import { CronPreviewBadge } from "./cron-preview-badge"

interface PlanInput {
  summary: string
  tasks: string  // JSON string of task array
}

interface PlanTask {
  employee_id?: number
  employee_name?: string
  task_name: string
  cron?: string | null
  execute_mode?: string
}

function parseTasks(input: unknown): PlanTask[] {
  if (!input || typeof input !== "object") return []
  const obj = input as Record<string, unknown>
  const tasksRaw = obj.tasks
  if (typeof tasksRaw !== "string") return []
  try {
    return JSON.parse(tasksRaw)
  } catch {
    return []
  }
}

export function PlanGeneratedCard({
  input,
  className,
}: {
  input: unknown
  className?: string
}) {
  const data = React.useMemo(() => {
    if (!input || typeof input !== "object") return null
    const obj = input as Record<string, unknown>
    const summary = typeof obj.summary === "string" ? obj.summary : ""
    const tasks = parseTasks(input)
    if (!summary && tasks.length === 0) return null
    return { summary, tasks }
  }, [input])

  if (!data) return null

  return (
    <div
      className={cn(
        "w-full max-w-lg rounded-xl border bg-card p-4 shadow-sm",
        className
      )}
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">编排计划已生成</p>
          {data.summary && (
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {data.summary}
            </p>
          )}
        </div>
        <span className="ml-2 shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
          {data.tasks.length} 个子任务
        </span>
      </div>

      <div className="space-y-1.5">
        {data.tasks.map((task, i) => (
          <div
            key={i}
            className="flex items-center gap-2 rounded-md bg-muted/30 px-2.5 py-1.5 text-xs"
          >
            <span className="size-2 shrink-0 rounded-full bg-muted-foreground/40" />
            <span className="min-w-0 flex-1 truncate font-medium">
              {task.task_name}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {task.employee_name || ""}
            </span>
            <CronPreviewBadge cron={task.cron} />
            <span
              className={cn(
                "shrink-0 text-[10px]",
                task.cron ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground"
              )}
            >
              {task.cron ? "定时" : "即时"}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-3 text-center text-[11px] text-muted-foreground">
        请回复「确认」开始执行
      </p>
    </div>
  )
}
