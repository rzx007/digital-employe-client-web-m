import { useEffect, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { IconExternalLink, IconLoader2 } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { MessageResponse } from "@workspace/ui/components/ai-elements/message"
import { cn } from "@workspace/ui/lib/utils"
import { submitSkillRating } from "@/api/skill-ratings"
import { StarRating } from "./star-rating"
import type { TaskExecution } from "@/types/schedule-monitor"
import { formatExecutionDuration } from "./execution-card"
import { navigateToEmployeeFromCurator } from "@/lib/chat/curator-navigation"

const STATUS_CONFIG: Record<
  string,
  { label: string; className: string; stampText: string }
> = {
  success: {
    label: "成功",
    className:
      "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
    stampText: "已完成",
  },
  failed: {
    label: "失败",
    className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
    stampText: "失败",
  },
  timeout: {
    label: "超时",
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    stampText: "超时",
  },
  cancelled: {
    label: "已取消",
    className:
      "bg-gray-100 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400",
    stampText: "已取消",
  },
  running: {
    label: "进行中",
    className:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
    stampText: "",
  },
  queued: {
    label: "排队中",
    className:
      "bg-slate-100 text-slate-600 dark:bg-slate-800/40 dark:text-slate-400",
    stampText: "",
  },
  pending: {
    label: "排队中",
    className:
      "bg-slate-100 text-slate-600 dark:bg-slate-800/40 dark:text-slate-400",
    stampText: "",
  },
}

/** 运行中时每秒 tick，驱动实时耗时显示（非运行态不计时）。 */
function useElapsedNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active])
  return now
}

const COMPACT_OUTPUT_MAX = 120

function truncateOutput(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

export type ExecutionReportCardProps = {
  execution: TaskExecution
  className?: string
  /** 总管会话已有结果摘要时，卡片只保留状态与跳转 */
  compact?: boolean
  curatorContactId?: string | null
  curatorConversationId?: string | number | null
}

export function ExecutionReportCard({
  execution,
  className,
  compact = false,
  curatorContactId,
  curatorConversationId,
}: ExecutionReportCardProps) {
  const ratingMutation = useMutation({
    mutationFn: (score: number) =>
      submitSkillRating({
        task_execution_log_id: execution.id,
        score,
        comment: "",
      }),
  })
  const [expanded, setExpanded] = useState(false)

  const outputText = execution.output?.content ?? execution.run_result ?? ""
  const statusCfg = STATUS_CONFIG[execution.run_status]
  const isFinished =
    execution.run_status === "success" ||
    execution.run_status === "failed" ||
    execution.run_status === "timeout" ||
    execution.run_status === "cancelled"
  const isRunning = execution.run_status === "running"
  const isActive =
    isRunning ||
    execution.run_status === "queued" ||
    execution.run_status === "pending"

  // 运行中实时耗时（从 started_at 客户端 tick）；否则用后端 duration_ms。
  const now = useElapsedNow(isRunning)
  const liveElapsedMs = isRunning
    ? Math.max(0, now - new Date(execution.started_at).getTime())
    : null
  const durationMs = liveElapsedMs ?? execution.duration_ms
  const durationLabel =
    durationMs != null && Number.isFinite(durationMs)
      ? formatExecutionDuration(durationMs)
      : null

  const canJumpToEmployee =
    execution.conversation_id != null &&
    curatorContactId &&
    curatorConversationId != null

  const handleJumpToEmployee = () => {
    if (!canJumpToEmployee) return
    navigateToEmployeeFromCurator({
      curatorContactId,
      curatorConversationId,
      employeeId: String(execution.employee_id),
      employeeConversationId: execution.conversation_id!,
    })
  }

  if (compact) {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-dashed bg-muted/20 px-2.5 py-1.5 text-[11px]",
          className
        )}
      >
        <Badge
          variant="outline"
          className={cn(
            "gap-1 px-1.5 py-0 text-[10px]",
            statusCfg?.className ?? ""
          )}
        >
          {isRunning && <IconLoader2 className="size-2.5 animate-spin" />}
          {statusCfg?.label ?? execution.run_status}
        </Badge>
        <span className="min-w-0 truncate font-medium text-foreground/80">
          {execution.task_name}
        </span>
        {durationLabel && (
          <span className="text-muted-foreground/70">{durationLabel}</span>
        )}
        {canJumpToEmployee ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0 py-0 text-[11px] text-primary"
            onClick={handleJumpToEmployee}
          >
            查看 {execution.employee_name} 的对话
            <IconExternalLink className="size-3" />
          </Button>
        ) : null}
        {isFinished && (
          <StarRating
            value={execution.skill_rating?.score ?? 0}
            onChange={(score) => ratingMutation.mutate(score)}
            size={11}
          />
        )}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border bg-card p-3 text-sm",
        className
      )}
    >
      {isFinished && statusCfg && (
        <div className="pointer-events-none absolute top-2.5 right-2.5 select-none">
          <div
            className={cn(
              "rounded border-2 px-2 py-0.5 text-[11px] font-bold tracking-wider uppercase opacity-20",
              execution.run_status === "success" &&
                "rotate-[-12deg] border-green-600 text-green-700 dark:border-green-400 dark:text-green-400",
              execution.run_status === "failed" &&
                "rotate-[-12deg] border-red-600 text-red-700 dark:border-red-400 dark:text-red-400",
              execution.run_status === "timeout" &&
                "rotate-[-12deg] border-amber-600 text-amber-700 dark:border-amber-400 dark:text-amber-400",
              execution.run_status === "cancelled" &&
                "rotate-[-12deg] border-gray-500 text-gray-600 dark:border-gray-400 dark:text-gray-400"
            )}
          >
            {statusCfg.stampText}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              "gap-1 px-1.5 py-0 text-[10px]",
              statusCfg?.className ?? ""
            )}
          >
            {isRunning && <IconLoader2 className="size-2.5 animate-spin" />}
            {statusCfg?.label ?? execution.run_status}
          </Badge>
          <span className="truncate text-[11px] text-muted-foreground">
            {execution.task_name}
          </span>
          {durationLabel && (
            <span className="shrink-0 text-[10px] text-muted-foreground/60">
              耗时 {durationLabel}
            </span>
          )}
        </div>

        {outputText && (
          <div>
            <MessageResponse
              className={cn(
                "overflow-y-auto text-xs leading-relaxed text-muted-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
                expanded ? "max-h-96" : "max-h-32"
              )}
            >
              {expanded
                ? outputText
                : truncateOutput(outputText, COMPACT_OUTPUT_MAX)}
            </MessageResponse>
            {outputText.length > COMPACT_OUTPUT_MAX && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-0.5 text-[11px] text-primary hover:underline"
              >
                {expanded ? "收起" : "展开全部"}
              </button>
            )}
          </div>
        )}

        {/* P1：失败原因始终展示（不再被 output 遮盖） */}
        {execution.error_message && (
          <p className="text-xs text-red-600/80 dark:text-red-400/80">
            {truncateOutput(execution.error_message, COMPACT_OUTPUT_MAX)}
          </p>
        )}

        {isActive && !outputText && !execution.error_message && (
          <p className="text-xs text-muted-foreground/70">
            {isRunning ? "执行中…" : "排队等待中…"}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {isFinished && (
            <StarRating
              value={execution.skill_rating?.score ?? 0}
              onChange={(score) => ratingMutation.mutate(score)}
              size={12}
            />
          )}
          {canJumpToEmployee && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-[11px]"
              onClick={handleJumpToEmployee}
            >
              查看 {execution.employee_name} 的对话
              <IconExternalLink className="size-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
