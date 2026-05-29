"use client"

import * as React from "react"
import { memo } from "react"
import { cn } from "@workspace/ui/lib/utils"
import { CronPreviewBadge } from "./cron-preview-badge"
import { parsePlanTasksFromInput } from "@/lib/chat/plan-generated-payload"

interface PlanTask {
  employee_id?: number
  employee_name?: string
  task_name: string
  cron?: string | null
  execute_mode?: string
}

function parseTasks(input: unknown): PlanTask[] {
  return parsePlanTasksFromInput(input)
}

const STATE_CONFIG: Record<string, { title: string; titleClass: string }> = {
  call: {
    title: "正在生成编排计划...",
    titleClass: "text-muted-foreground animate-pulse",
  },
  "output-available": {
    title: "编排计划已生成",
    titleClass: "text-foreground",
  },
  "output-error": {
    title: "编排计划生成失败",
    titleClass: "text-destructive",
  },
}

function PlanGeneratedCardInner({
  input,
  state,
  className,
}: {
  input: unknown
  state?: string
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

  const cfg = STATE_CONFIG[state ?? ""] ?? STATE_CONFIG["output-available"]

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border bg-card p-3 text-sm",
        className
      )}
    >
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className={cn("text-xs font-semibold", cfg.titleClass)}>
            {cfg.title}
          </p>
          {data.summary && (
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {data.summary}
            </p>
          )}
        </div>
        <span className="shrink-0 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
          {data.tasks.length} 个子任务
        </span>
      </div>

      <div className="space-y-1">
        {data.tasks.map((task, i) => (
          <div
            key={i}
            className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-xs"
          >
            <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
            <span className="min-w-0 flex-1 truncate font-medium">
              {task.task_name}
            </span>
            {task.employee_name && (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {task.employee_name}
              </span>
            )}
            <CronPreviewBadge cron={task.cron} />
            <span
              className={cn(
                "shrink-0 text-[10px]",
                task.cron
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-muted-foreground"
              )}
            >
              {task.cron ? "定时" : "即时"}
            </span>
          </div>
        ))}
      </div>

      {/* {state !== "call" && state !== "output-error" && (
        <p className="mt-2.5 text-[11px] text-muted-foreground">
          回复「确认」开始执行
        </p>
      )} */}
    </div>
  )
}

export const PlanGeneratedCard = memo(PlanGeneratedCardInner)
