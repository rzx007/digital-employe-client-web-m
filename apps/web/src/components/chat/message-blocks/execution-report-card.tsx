import { useEffect, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import {
  IconChevronRight,
  IconExternalLink,
  IconLoader2,
  IconTool,
} from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { MessageResponse } from "@workspace/ui/components/ai-elements/message"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { cn } from "@workspace/ui/lib/utils"
import { submitSkillRating } from "@/api/skill-ratings"
import {
  useCancelTaskExecution,
  useToolFootprint,
} from "@/hooks/use-schedule-monitor-queries"
import { classifyMessageParts } from "@/lib/chat/message-classifier"
import type { ToolUIPart } from "@/lib/chat/tools/tool-part"
import { StarRating } from "./star-rating"
import { ToolGroupBlock } from "./tool-group-block"
import type { TaskExecution } from "@/types/schedule-monitor"
import { formatExecutionDuration } from "./execution-card"
import { navigateToEmployeeFromCurator } from "@/lib/chat/curator-navigation"
import type { UIMessage } from "ai"

function ToolFootprintBlocks({
  logId,
  parts,
}: {
  logId: number
  parts: Record<string, unknown>[]
}) {
  const blocks = classifyMessageParts({
    id: `footprint-${logId}`,
    role: "assistant",
    parts: parts as unknown as ToolUIPart[],
  } as UIMessage)
  const toolGroups = blocks.filter((b) => b.kind === "tool-group")
  if (toolGroups.length === 0) return null
  return (
    <div className="space-y-1">
      {toolGroups.map((b, i) => (
        <ToolGroupBlock
          key={i}
          block={b as Extract<typeof b, { kind: "tool-group" }>}
        />
      ))}
    </div>
  )
}

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
  superseded: {
    label: "已打回",
    className:
      "bg-gray-100 text-gray-500 dark:bg-gray-800/40 dark:text-gray-400",
    stampText: "已打回",
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
/** 心跳超过此时长未刷新（约 3 个 30s 心跳周期）视为「可能卡死」。 */
const STALE_HEARTBEAT_MS = 90_000

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
  const [cancelOpen, setCancelOpen] = useState(false)
  const [footprintOpen, setFootprintOpen] = useState(false)
  const { data: footprint, isPending: footprintLoading } = useToolFootprint(
    execution.id,
    { enabled: footprintOpen }
  )
  const cancelMutation = useCancelTaskExecution(curatorConversationId)

  const outputText = execution.output?.content ?? execution.run_result ?? ""
  const statusCfg = STATUS_CONFIG[execution.run_status]
  const isFinished =
    execution.run_status === "success" ||
    execution.run_status === "failed" ||
    execution.run_status === "timeout" ||
    execution.run_status === "cancelled" ||
    execution.run_status === "superseded"
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

  // 心跳活性：运行中但 last_heartbeat_at 超过 ~3 个心跳周期没刷新 → 可能卡死。
  // 健康态由 spinner + 实时耗时已表达，这里只突出可操作信号（卡死提示）。
  const heartbeatStale =
    isRunning &&
    execution.last_heartbeat_at != null &&
    now - new Date(execution.last_heartbeat_at).getTime() > STALE_HEARTBEAT_MS

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

  // 「中止」仅在运行中可用；确认后端会终止会话流并标记 cancelled，
  // 其依赖的后续任务由编排 DAG 一并跳过（弹窗已明确警告）。
  const handleCancelConfirm = () => {
    cancelMutation.mutate(execution.id, {
      onSuccess: () => setCancelOpen(false),
    })
  }
  const cancelDialog = (
    <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>中止任务</AlertDialogTitle>
          <AlertDialogDescription>
            中止「{execution.task_name}
            」后，其依赖的后续任务将一并跳过。确定中止？
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={cancelMutation.isPending}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleCancelConfirm}
            disabled={cancelMutation.isPending}
          >
            {cancelMutation.isPending ? "中止中…" : "确认中止"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  if (compact) {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-dashed bg-muted/20 px-2.5 py-1.5 text-[11px]",
          className
        )}
      >
        {cancelDialog}
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
        {heartbeatStale && (
          <span className="text-amber-600 dark:text-amber-400">· 可能卡死</span>
        )}
        {(execution.rework_count ?? 0) > 0 && (
          <span className="text-amber-600 dark:text-amber-400">
            · 返工 {execution.rework_count} 次
          </span>
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
        {isRunning && (
          <button
            type="button"
            onClick={() => setCancelOpen(true)}
            className="text-[11px] text-muted-foreground/70 hover:text-destructive"
          >
            中止
          </button>
        )}
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
      {cancelDialog}
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
                "rotate-[-12deg] border-gray-500 text-gray-600 dark:border-gray-400 dark:text-gray-400",
              execution.run_status === "superseded" &&
                "rotate-[-12deg] border-gray-500 text-gray-500 dark:border-gray-400 dark:text-gray-400"
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
          {heartbeatStale && (
            <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-400">
              · 可能卡死
            </span>
          )}
          {(execution.rework_count ?? 0) > 0 && (
            <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-400">
              · 返工 {execution.rework_count} 次
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
          {isRunning && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-[11px] text-muted-foreground hover:text-destructive"
              onClick={() => setCancelOpen(true)}
            >
              中止
            </Button>
          )}
        </div>

        {/* 工具足迹是「事后」视图：message_parts 仅在流终态落库，运行中抽不到工具(显示 0)，
            故仅对已完成的执行显示足迹条;运行中由 spinner/⏳/「可能卡死」表达进度。 */}
        {execution.conversation_id != null && isFinished && (
          <div>
            <button
              type="button"
              onClick={() => setFootprintOpen((v) => !v)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <IconTool className="size-3" />
              工具足迹{footprint ? ` (${footprint.tool_count})` : ""}
              <IconChevronRight
                className={cn(
                  "size-3 transition-transform",
                  footprintOpen && "rotate-90"
                )}
              />
            </button>
            {footprintOpen && (
              <div className="mt-1">
                {footprintLoading ? (
                  <IconLoader2 className="size-3 animate-spin text-muted-foreground" />
                ) : footprint && footprint.tool_count > 0 ? (
                  <ToolFootprintBlocks
                    logId={execution.id}
                    parts={footprint.parts}
                  />
                ) : (
                  <p className="text-[11px] text-muted-foreground/70">
                    无工具调用
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
