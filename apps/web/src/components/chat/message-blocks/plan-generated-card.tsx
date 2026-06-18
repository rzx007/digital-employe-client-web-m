"use client"

import * as React from "react"
import { memo, useState } from "react"
import { IconPencil, IconRoute, IconX } from "@tabler/icons-react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { toast } from "sonner"
import {
  cancelOrchestrationPlan,
  confirmOrchestrationPlan,
  fetchOrchestrationPlanDetail,
} from "@/api/orchestration"
import { PlanEditDialog } from "./plan-edit-dialog"
import { PlanDeliverablesCard } from "./plan-deliverables-card"
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
  const [editOpen, setEditOpen] = useState(false)

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

  // 可编辑（待确认）时拉取实时子任务，用其 employee_name 覆盖卡片显示，
  // 与编辑弹窗共用同一 query key——弹窗保存后 refetch 会同步刷新卡片。
  const canEdit = showActionPanel && planOutput != null
  // 计划已生成且本轮结束后拉取详情：待确认→供编辑;执行/完成→供「团队交付物」聚合。
  const planDetailEnabled = planOutput != null && isTurnEnded
  const planDetailQuery = useQuery({
    queryKey: [...chatKeys.all, "orchestration-plan-detail", planOutput?.plan_id],
    queryFn: ({ signal }) =>
      fetchOrchestrationPlanDetail(planOutput!.plan_id, { signal }),
    enabled: planDetailEnabled,
    staleTime: 0,
  })
  // task_id → 最新 employee_name（编辑换员工后据此刷新卡片行显示）
  const detailEmployeeNameById = React.useMemo(() => {
    const m: Record<number, string> = {}
    for (const t of planDetailQuery.data?.tasks ?? []) m[t.task_id] = t.employee_name
    return m
  }, [planDetailQuery.data])
  const planArtifacts = planDetailQuery.data?.artifacts ?? []
  // 子任务陆续完成时刷新详情，让「团队交付物」随产出增长。
  const refetchPlanDetail = planDetailQuery.refetch
  React.useEffect(() => {
    if (planDetailEnabled) void refetchPlanDetail()
  }, [completed, planDetailEnabled, refetchPlanDetail])

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
        "relative overflow-hidden rounded-xl border border-border/60 bg-card p-3.5 text-sm shadow-sm",
        className
      )}
    >
      <div className="mb-3 flex items-start gap-2.5">
        <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <IconRoute className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-semibold leading-tight", cfg.titleClass)}>
            {cfg.title}
          </p>
          {data.summary && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {data.summary}
            </p>
          )}
        </div>
        <span className="mt-0.5 shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {data.tasks.length} 项
        </span>
      </div>

      {/* 确认前展示可读/可编辑的任务列表；确认后由下方进度条接管，避免重复渲染 */}
      {!showConfirmedMessage && !showCancelledMessage && (
      <div className="space-y-0.5">
        {data.tasks.map((task: PlanTaskPreview, i: number) => (
          <div
            key={task.task_id ?? i}
            className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-xs transition-colors hover:bg-muted/50"
          >
            <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
            <span className="min-w-0 flex-1 truncate font-medium text-foreground/90">
              {task.task_name}
            </span>
            <CronPreviewBadge cron={task.cron} />
            {(() => {
              const empName =
                (task.task_id != null
                  ? detailEmployeeNameById[task.task_id]
                  : undefined) ?? task.employee_name
              return empName ? (
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {empName}
                </span>
              ) : null
            })()}
          </div>
        ))}
      </div>
      )}

      {showActionPanel && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-3">
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
              className="h-7 text-xs text-muted-foreground"
              disabled={manualStatus !== "idle"}
              onClick={() => setEditOpen(true)}
            >
              <IconPencil className="mr-1 size-3" />
              编辑
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
          {planOutput != null ? (
            <PlanEditDialog
              planId={planOutput.plan_id}
              open={editOpen}
              onOpenChange={setEditOpen}
              onSaved={() => {
                void queryClient.invalidateQueries({
                  queryKey: [...chatKeys.all, "orchestration-plans"],
                })
              }}
            />
          ) : null}
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
      {showConfirmedMessage && planArtifacts.length > 0 ? (
        <PlanDeliverablesCard
          className="mt-2.5"
          artifacts={planArtifacts}
          conversationId={conversationId}
        />
      ) : null}
      {showCancelledMessage && (
        <p className="mt-2.5 text-[11px] text-muted-foreground">
          已取消该编排计划。
        </p>
      )}
    </div>
  )
}

export const PlanGeneratedCard = memo(PlanGeneratedCardInner)
