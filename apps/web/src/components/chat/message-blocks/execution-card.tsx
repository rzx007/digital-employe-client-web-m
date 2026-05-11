import * as React from "react"
import {
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
  IconMaximize,
  IconMinimize,
  IconSend,
} from "@tabler/icons-react"
import { useMutation } from "@tanstack/react-query"
import { format } from "date-fns"
import { zhCN } from "date-fns/locale"
import { toast } from "sonner"
import { MessageResponse } from "@workspace/ui/components/ai-elements/message"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"
import { submitSkillRating } from "@/api/skill-ratings"
import type { SkillRatingOutput, TaskExecution } from "@/types/schedule-monitor"
import { StarRating } from "./star-rating"

export const EXECUTION_STATUS_CONFIG: Record<
  string,
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

const SUMMARY_MAX_LENGTH = 200

export function formatExecutionDuration(ms: number | null): string {
  if (ms == null) return "-"
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatExecutionTime(iso: string): string {
  const d = new Date(iso)
  return format(d, "HH:mm:ss", { locale: zhCN })
}

function parseExecutionMessage(msg: string): string {
  const match = msg.match(/^content='((?:[^'\\]|\\.)*)'/)
  if (match) {
    let content = match[1]
    content = content.replace(/\\n/g, "\n")
    content = content.replace(/\\r/g, "\r")
    content = content.replace(/\\t/g, "\t")
    content = content.replace(/\\'/g, "'")
    content = content.replace(/\\\\/g, "\\")
    return content
  }
  return msg.replace(/\r\n/g, "\n").trim()
}

export function getExecutionResultText(execution: TaskExecution): string {
  if (execution.output?.content) {
    return parseExecutionMessage(execution.output.content)
  }
  return execution.run_result ?? ""
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + "..."
}

export function ExecutionDetailDialog({
  execution,
  open,
  onOpenChange,
}: {
  execution: TaskExecution
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const config =
    EXECUTION_STATUS_CONFIG[execution.run_status] ??
    EXECUTION_STATUS_CONFIG.pending
  const resultText = getExecutionResultText(execution)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          isFullscreen
            ? "fixed inset-0 z-50 h-full w-screen! max-w-screen! translate-x-0 translate-y-0 rounded-none"
            : "max-w-2xl!"
        )}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="truncate">{execution.task_name}</span>
            <Badge
              variant="outline"
              className={cn("px-1.5 py-0 text-[10px]", config.className)}
            >
              {config.label}
            </Badge>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto shrink-0 rounded-sm hover:bg-accent"
              onClick={() => setIsFullscreen(!isFullscreen)}
            >
              {isFullscreen ? (
                <IconMinimize className="size-3.5" />
              ) : (
                <IconMaximize className="size-3.5" />
              )}
            </Button>
            <span className="mr-5 text-xs text-muted-foreground">
              {formatExecutionDuration(execution.duration_ms)} ·{" "}
              {formatExecutionTime(execution.started_at)}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div
          className={cn(
            "-mx-4 overflow-auto px-4",
            isFullscreen ? "h-[calc(100vh-5rem)]" : "max-h-[60vh]"
          )}
        >
          <div className="space-y-4">
            {resultText && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  执行结果
                </p>
                <MessageResponse className="text-sm">
                  {resultText}
                </MessageResponse>
              </div>
            )}

            {execution.error_message && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-red-600 dark:text-red-400">
                  错误信息
                </p>
                <p className="text-sm leading-relaxed text-red-600/80 dark:text-red-400/80">
                  {execution.error_message}
                </p>
              </div>
            )}

            {!resultText && !execution.error_message && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                暂无详细信息
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface ExecutionCardProps {
  execution: TaskExecution
  className?: string
}

export function ExecutionCard({ execution, className }: ExecutionCardProps) {
  const [expanded, setExpanded] = React.useState(false)
  const [detailOpen, setDetailOpen] = React.useState(false)
  const config =
    EXECUTION_STATUS_CONFIG[execution.run_status] ??
    EXECUTION_STATUS_CONFIG.pending
  const resultText = getExecutionResultText(execution)
  const isTruncated = resultText.length > SUMMARY_MAX_LENGTH
  const summaryText = truncateText(resultText, SUMMARY_MAX_LENGTH)

  return (
    <>
      <div className={cn("rounded-lg border bg-card", className)}>
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <IconChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate text-xs font-medium">
            {execution.task_name}
          </span>
          <Badge
            variant="outline"
            className={cn("shrink-0 px-1.5 py-0 text-[10px]", config.className)}
          >
            {config.label}
          </Badge>
          <span
            className={cn(
              "shrink-0 text-[10px] tabular-nums",
              execution.duration_ms != null && execution.duration_ms >= 30000
                ? "text-red-500"
                : "text-muted-foreground"
            )}
          >
            {formatExecutionDuration(execution.duration_ms)}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
            {formatExecutionTime(execution.started_at)}
          </span>
        </button>

        {expanded && (
          <div className="space-y-1.5 border-t px-3 py-2">
            {resultText && (
              <div className="rounded bg-muted/50 p-2">
                <p className="mb-1 text-[10px] font-medium text-muted-foreground">
                  执行结果
                </p>
                <MessageResponse className="text-[10px]">
                  {summaryText}
                </MessageResponse>
                {isTruncated && (
                  <button
                    type="button"
                    className="mt-1.5 flex items-center gap-1 text-[10px] text-primary hover:underline"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDetailOpen(true)
                    }}
                  >
                    <IconExternalLink className="size-3" />
                    查看详情
                  </button>
                )}
              </div>
            )}

            {!resultText && execution.error_message && (
              <div className="rounded bg-red-50 p-2 dark:bg-red-950/30">
                <p className="mb-1 text-[10px] font-medium text-red-600 dark:text-red-400">
                  错误信息
                </p>
                <p className="text-[10px] leading-relaxed text-red-600/80 dark:text-red-400/80">
                  {execution.error_message}
                </p>
              </div>
            )}

            {!resultText && !execution.error_message && (
              <p className="py-1 text-center text-[10px] text-muted-foreground">
                暂无详细信息
              </p>
            )}
            {execution.run_status !== "running" && (
              <RatingSection
                executionId={execution.id}
                skillRating={execution.skill_rating}
              />
            )}
          </div>
        )}
      </div>

      <ExecutionDetailDialog
        execution={execution}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </>
  )
}

function RatingSection({
  executionId,
  skillRating,
}: {
  executionId: number
  skillRating?: SkillRatingOutput | null
}) {
  const hasRated = !!skillRating
  const [score, setScore] = React.useState(skillRating?.score ?? 0)
  const [comment, setComment] = React.useState(skillRating?.comment ?? "")
  const [expanded, setExpanded] = React.useState(!!skillRating?.comment)

  const mutation = useMutation({
    mutationFn: submitSkillRating,
    onSuccess: (res) => {
      if (res.code === 0) {
        setComment("")
      } else {
        toast.error(res.msg || "评分提交失败")
      }
    },
    onError: () => {
      toast.error("评分提交失败，请稍后重试")
    },
  })

  const handleQuickRate = (newScore: number) => {
    if (hasRated) return
    setScore(newScore)
    mutation.mutate({
      task_execution_log_id: executionId,
      score: newScore,
      comment: "",
    })
  }

  const handleSubmit = () => {
    if (hasRated) return
    mutation.mutate({
      task_execution_log_id: executionId,
      score,
      comment,
    })
  }

  return (
    <div className="mt-2 space-y-2 rounded border border-dashed p-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground">评分</span>
        <StarRating
          value={score}
          onChange={
            hasRated ? undefined : expanded ? setScore : handleQuickRate
          }
          size={14}
          disabled={hasRated || mutation.isPending}
        />
        {!hasRated && (
          <button
            type="button"
            className="ml-auto text-[10px] text-muted-foreground hover:text-primary"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "收起" : "添加评语"}
          </button>
        )}
        {hasRated && (
          <span className="ml-auto text-[10px] text-green-600 dark:text-green-400">
            已评分
          </span>
        )}
      </div>
      {expanded && (
        <>
          <Textarea
            placeholder="添加评语..."
            value={comment}
            onChange={(e) => !hasRated && setComment(e.target.value)}
            className="min-h-[60px] resize-none text-[10px]"
            disabled={hasRated}
          />
          {!hasRated && (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="default"
                onClick={handleSubmit}
                disabled={mutation.isPending}
                className="h-6 text-[10px]"
              >
                <IconSend className="mr-1 size-3" />
                {mutation.isPending ? "提交中..." : "提交评分"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
