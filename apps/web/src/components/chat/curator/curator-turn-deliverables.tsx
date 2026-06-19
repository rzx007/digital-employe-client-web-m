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
 */
export function CuratorTurnDeliverables({
  conversationId,
  className,
}: {
  conversationId?: string | number | null
  className?: string
}) {
  const { data: plans } = useOrchestrationPlansQuery(conversationId)

  // 取最近一个「已离开 pending、未取消」的计划（list_plans 按 id 倒序，故第一个即最新）。
  const plan = React.useMemo(
    () =>
      (plans ?? []).find(
        (p) => p.status !== "pending" && p.status !== "cancelled"
      ),
    [plans]
  )
  const planId = plan?.id
  const planStatus = plan?.status

  const detailQuery = useQuery({
    queryKey: [...chatKeys.all, "orchestration-plan-detail", planId],
    queryFn: ({ signal }) =>
      fetchOrchestrationPlanDetail(planId!, { signal }),
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
