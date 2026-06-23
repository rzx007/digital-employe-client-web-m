"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { fetchOrchestrationPlanDetail } from "@/api/orchestration"
import { PlanDeliverablesCard } from "@/components/chat/message-blocks/plan-deliverables-card"
import { useOrchestrationPlansQuery } from "@/hooks/use-chat-queries"
import { chatKeys } from "@/lib/query-keys/chat"

/**
 * 总管交付物页脚（#子任务产物回流主对话）：在对话底部（用户看结果的地方）展示
 * 最近一个已执行编排计划的团队交付物——覆盖委派场景，且不被埋在靠上的计划卡里。
 * 无已执行计划 / 无产物时不渲染。
 *
 * per-run 定时轮会话（session_flags.kind==="scheduled_run"）：从 session_flags
 * 取 plan_id（该会话不会出现在 useOrchestrationPlansQuery(convId) 结果里——其
 * plan.conversation_id 指向创建源会话），并把当前 conversationId 透传给详情接口，
 * 后端按本轮 run 过滤 → 只渲本轮交付物。
 */
export function CuratorTurnDeliverables({
  conversationId,
  sessionFlags,
  className,
}: {
  conversationId?: string | number | null
  sessionFlags?: string | null
  className?: string
}) {
  const scheduledRun = React.useMemo(() => {
    if (!sessionFlags) return null
    try {
      const parsed = JSON.parse(sessionFlags) as {
        kind?: string
        plan_id?: number
      }
      if (parsed?.kind === "scheduled_run" && parsed.plan_id != null) {
        return { planId: parsed.plan_id }
      }
    } catch {
      // 忽略非法 session_flags
    }
    return null
  }, [sessionFlags])

  // per-run 会话不查 plans-list（找不到自己的 plan），普通会话才查。
  const { data: plans } = useOrchestrationPlansQuery(
    scheduledRun ? null : conversationId
  )

  // 取最近一个「已离开 pending、未取消」的计划（list_plans 按 id 倒序，故第一个即最新）。
  const listedPlan = React.useMemo(
    () =>
      (plans ?? []).find(
        (p) => p.status !== "pending" && p.status !== "cancelled"
      ),
    [plans]
  )
  const planId = scheduledRun ? scheduledRun.planId : listedPlan?.id
  const planStatus = listedPlan?.status

  // 当前会话 id 透传给详情接口，让后端按本会话对应 run 过滤产物。
  const convIdNum =
    conversationId != null && conversationId !== ""
      ? Number(conversationId)
      : null

  const detailQuery = useQuery({
    queryKey: [
      ...chatKeys.all,
      "orchestration-plan-detail",
      planId,
      convIdNum,
    ],
    queryFn: ({ signal }) =>
      fetchOrchestrationPlanDetail(planId!, { signal, conversationId: convIdNum }),
    enabled: planId != null,
    staleTime: 0,
  })

  // 计划状态推进（执行中→完成）时刷新，让交付物随子任务产出增长。
  const refetch = detailQuery.refetch
  React.useEffect(() => {
    if (planId != null) void refetch()
  }, [planId, planStatus, refetch])

  const artifacts = detailQuery.data?.artifacts ?? []
  if (artifacts.length === 0) return null

  return (
    <PlanDeliverablesCard
      className={className}
      artifacts={artifacts}
      conversationId={conversationId}
    />
  )
}
