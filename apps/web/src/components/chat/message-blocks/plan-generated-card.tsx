"use client"

import * as React from "react"
import { memo, useState } from "react"
import { IconX } from "@tabler/icons-react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { toast } from "sonner"
import {
  cancelOrchestrationPlan,
  confirmOrchestrationPlan,
} from "@/api/orchestration"
import { useOrchestrationPlansQuery } from "@/hooks/use-chat-queries"
import { chatKeys } from "@/lib/query-keys/chat"
import { CronPreviewBadge } from "./cron-preview-badge"
import {
  buildPlanManualCancelOutbound,
  buildPlanManualConfirmOutbound,
  parsePlanGeneratedOutput,
  resolvePlanTasksForCard,
  type PlanTaskPreview,
} from "@/lib/chat/plan-generated-payload"
import { useCuratorPlanFeedback } from "@/components/chat/curator/curator-plan-feedback-context"
import type { ToolUiActionOutbound } from "@/lib/chat/tool-ui-action"
import { TaskProgressBar } from "./task-progress-bar"
import { usePlanProgress } from "@/hooks/use-plan-progress"
import type { OrchestrationTaskProgress } from "./orchestration-plan-card"

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

type ManualPlanStatus =
  | "idle"
  | "confirming"
  | "cancelling"
  | "confirmed"
  | "cancelled"

function PlanGeneratedCardInner({
  input,
  state,
  resultText,
  conversationId,
  isTurnEnded = true,
  onSendUserMessage,
  className,
}: {
  input: unknown
  state?: string
  resultText?: string | null
  conversationId?: string | number | null
  isTurnEnded?: boolean
  onSendUserMessage?: (text: string) => Promise<void>
  className?: string
}) {
  const queryClient = useQueryClient()
  const planFeedback = useCuratorPlanFeedback()
  const sendPlanFeedbackFromContext = planFeedback?.sendPlanFeedback ?? null
  const [manualStatus, setManualStatus] = useState<ManualPlanStatus>("idle")

  const planOutput = React.useMemo(
    () => parsePlanGeneratedOutput(resultText),
    [resultText]
  )

  const { data: orchestrationPlans } =
    useOrchestrationPlansQuery(conversationId)

  const planRecord = React.useMemo(
    () => orchestrationPlans?.find((plan) => plan.id === planOutput?.plan_id),
    [orchestrationPlans, planOutput?.plan_id]
  )

  const remoteStatus = planRecord?.status

  const data = React.useMemo(() => {
    const tasks = resolvePlanTasksForCard(input, resultText)
    let summary = ""
    if (input && typeof input === "object") {
      const obj = input as Record<string, unknown>
      summary = typeof obj.summary === "string" ? obj.summary : ""
    }
    if (!summary && planOutput?.summary) {
      summary = planOutput.summary
    }
    if (!summary && tasks.length === 0) return null
    return { summary, tasks }
  }, [input, resultText, planOutput?.summary])

  // 子任务实时进度：确认执行后，按 task_started/completed/failed 事件聚合。
  const planTaskIds = React.useMemo(
    () =>
      (data?.tasks ?? [])
        .map((t) => t.task_id)
        .filter((id): id is number => typeof id === "number"),
    [data?.tasks]
  )
  const { statusByTaskId, completed, total } = usePlanProgress(
    planTaskIds,
    conversationId
  )

  const isPlanPending =
    remoteStatus === "pending" ||
    (remoteStatus == null && manualStatus === "idle")

  const showActionPanel =
    state === "output-available" &&
    planOutput != null &&
    isPlanPending &&
    isTurnEnded &&
    (manualStatus === "idle" ||
      manualStatus === "confirming" ||
      manualStatus === "cancelling")

  const showConfirmedMessage =
    manualStatus === "confirmed" ||
    (remoteStatus != null &&
      remoteStatus !== "pending" &&
      remoteStatus !== "cancelled" &&
      manualStatus !== "cancelled")

  const showCancelledMessage =
    manualStatus === "cancelled" || remoteStatus === "cancelled"

  const notifyModelAfterPlanAction = async (
    outbound: ToolUiActionOutbound,
    actionLabel: string
  ) => {
    if (!sendPlanFeedbackFromContext && !onSendUserMessage) {
      toast.warning(`${actionLabel}成功，但无法自动通知总管`)
      return
    }
    try {
      if (sendPlanFeedbackFromContext) {
        await sendPlanFeedbackFromContext(outbound)
      } else if (onSendUserMessage) {
        await onSendUserMessage(outbound.agentText)
      }
    } catch (err) {
      toast.error(`${actionLabel}成功，但通知总管失败`, {
        description: err instanceof Error ? err.message : "请手动告知总管",
      })
    }
  }

  const handleConfirm = async () => {
    if (!planOutput) return
    setManualStatus("confirming")
    try {
      await confirmOrchestrationPlan(planOutput.plan_id)
      setManualStatus("confirmed")
      void queryClient.invalidateQueries({
        queryKey: [...chatKeys.all, "orchestration-plans"],
      })
      await notifyModelAfterPlanAction(
        buildPlanManualConfirmOutbound(planOutput.plan_id, data?.summary),
        "确认执行"
      )
    } catch (err) {
      setManualStatus("idle")
      toast.error(err instanceof Error ? err.message : "确认执行失败")
    }
  }

  const handleCancel = async () => {
    if (!planOutput) return
    setManualStatus("cancelling")
    try {
      await cancelOrchestrationPlan(planOutput.plan_id)
      setManualStatus("cancelled")
      void queryClient.invalidateQueries({
        queryKey: [...chatKeys.all, "orchestration-plans"],
      })
      await notifyModelAfterPlanAction(
        buildPlanManualCancelOutbound(planOutput.plan_id, data?.summary),
        "取消计划"
      )
    } catch (err) {
      setManualStatus("idle")
      toast.error(err instanceof Error ? err.message : "取消计划失败")
    }
  }

  if (!data) {
    const cfg = STATE_CONFIG[state ?? ""] ?? STATE_CONFIG.call
    const pendingState =
      state === "call" ||
      state === "input-streaming" ||
      state === "input-available"
    const summaryHint =
      planOutput?.summary?.trim() ||
      (input &&
      typeof input === "object" &&
      typeof (input as Record<string, unknown>).summary === "string"
        ? String((input as Record<string, unknown>).summary).trim()
        : "")

    return (
      <div
        className={cn(
          "relative overflow-hidden rounded-lg border bg-card p-3 text-sm",
          className
        )}
      >
        <p className={cn("text-xs font-semibold", cfg.titleClass)}>
          {cfg.title}
        </p>
        {summaryHint ? (
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {summaryHint}
          </p>
        ) : pendingState ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            正在解析编排计划，请稍候…
          </p>
        ) : planOutput ? (
          <>
            <p className="mt-1 text-[11px] text-muted-foreground">
              计划 #{planOutput.plan_id} 已生成，子任务列表加载中。
            </p>
            {showActionPanel && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={manualStatus !== "idle"}
                  onClick={() => void handleConfirm()}
                >
                  {manualStatus === "confirming" ? "确认中..." : "确认执行"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  disabled={manualStatus !== "idle"}
                  onClick={() => void handleCancel()}
                >
                  <IconX className="mr-1 size-3" />
                  {manualStatus === "cancelling" ? "取消中..." : "取消计划"}
                </Button>
              </div>
            )}
          </>
        ) : (
          <p className="mt-1 text-[11px] text-muted-foreground">
            编排计划卡片数据不完整，请刷新页面后重试。
          </p>
        )}
      </div>
    )
  }

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
        {data.tasks.map((task: PlanTaskPreview, i: number) => (
          <div
            key={task.task_id ?? i}
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

      {showActionPanel && (
        <>
          <p className="mt-2.5 text-[11px] text-muted-foreground">
            请确认任务拆解无误后再执行。
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              disabled={manualStatus !== "idle"}
              onClick={() => void handleConfirm()}
            >
              {manualStatus === "confirming" ? "确认中..." : "确认执行"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={manualStatus !== "idle"}
              onClick={() => void handleCancel()}
            >
              <IconX className="mr-1 size-3" />
              {manualStatus === "cancelling" ? "取消中..." : "取消计划"}
            </Button>
          </div>
        </>
      )}

      {state === "output-available" &&
        planOutput != null &&
        isPlanPending &&
        !isTurnEnded &&
        manualStatus === "idle" && (
          <p className="mt-2.5 text-[11px] text-muted-foreground">
            总管回复完成后可确认或取消。
          </p>
        )}

      {showConfirmedMessage &&
        (planTaskIds.length > 0 ? (
          <TaskProgressBar
            className="mt-2.5 max-w-none border-0 bg-transparent p-0 shadow-none"
            planId={planOutput?.plan_id ?? 0}
            summary={data.summary}
            total={total}
            completed={completed}
            tasks={data.tasks.map<OrchestrationTaskProgress>((t, i) => ({
              task_id: t.task_id ?? i,
              task_name: t.task_name,
              employee_name: t.employee_name ?? "",
              status:
                t.task_id != null
                  ? (statusByTaskId[t.task_id] ?? "pending")
                  : "pending",
              cron: t.cron,
              execute_mode: t.execute_mode ?? "immediate",
            }))}
          />
        ) : (
          <p className="mt-2.5 text-[11px] text-muted-foreground">
            已确认执行，子任务将按编排开始运行。
          </p>
        ))}
      {showCancelledMessage && (
        <p className="mt-2.5 text-[11px] text-muted-foreground">
          已取消该编排计划。
        </p>
      )}
    </div>
  )
}

export const PlanGeneratedCard = memo(PlanGeneratedCardInner)
