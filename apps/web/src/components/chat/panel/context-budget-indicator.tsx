"use client"

import * as React from "react"
import type { UIMessage } from "ai"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@workspace/ui/components/hover-card"
import { Progress } from "@workspace/ui/components/progress"
import { cn } from "@workspace/ui/lib/utils"

import { useContextBudget } from "@/hooks/use-context-budget"
import {
  formatTokenCount,
  zoneColorClass,
  type ContextBudgetZone,
} from "@/lib/chat/context-budget"

type ContextBudgetIndicatorProps = {
  conversationId?: string | number | null
  messages: UIMessage[]
  chatStatus: "submitted" | "streaming" | "ready" | "error"
  className?: string
}

function thresholdMarkerPercent(threshold: number, max: number): number {
  if (max <= 0) return 0
  return Math.min(100, Math.max(0, (threshold / max) * 100))
}

export function ContextBudgetIndicator({
  conversationId,
  messages,
  chatStatus,
  className,
}: ContextBudgetIndicatorProps) {
  const { budget, isLoading } = useContextBudget(
    conversationId,
    messages,
    chatStatus
  )

  if (!conversationId) return null

  const max = budget?.max_input_tokens ?? 131072
  const used = budget?.last_input_tokens ?? null
  const usedPercent =
    used != null && max > 0 ? Math.min(100, (used / max) * 100) : null
  const summarizePct = thresholdMarkerPercent(
    budget?.summarization_threshold ?? max * 0.75,
    max
  )
  const truncatePct = thresholdMarkerPercent(
    budget?.truncate_args_threshold ?? max * 0.5,
    max
  )
  const zone: ContextBudgetZone = budget?.zone ?? "unknown"

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-8 min-w-[4.5rem] items-center justify-center gap-1 rounded-md px-2 text-xs",
            "text-muted-foreground hover:bg-muted/60",
            className
          )}
          title="上下文用量"
        >
          {isLoading && used == null ? (
            <span>上下文 …</span>
          ) : usedPercent != null ? (
            <>
              <span className={cn("font-medium tabular-nums", zoneColorClass(zone))}>
                {usedPercent.toFixed(0)}%
              </span>
              <span className="hidden sm:inline">上下文</span>
            </>
          ) : (
            <span>上下文 —</span>
          )}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-72 space-y-3 p-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">上下文用量</p>
          <p className={cn("text-xs", zoneColorClass(zone))}>
            {budget?.zone_label ?? "首轮回复完成后显示"}
            {budget?.source === "estimated"
              ? " · 估算"
              : budget?.source === "api_usage"
                ? " · API"
                : null}
          </p>
        </div>

        {used != null ? (
          <div className="space-y-2">
            <div className="flex justify-between font-mono text-xs text-muted-foreground">
              <span>输入 {formatTokenCount(used)}</span>
              <span>/ {formatTokenCount(max)}</span>
            </div>
            <div className="relative">
              <Progress value={usedPercent ?? 0} className="h-2" />
              <div
                className="absolute top-0 h-2 w-px bg-amber-500/80"
                style={{ left: `${truncatePct}%` }}
                title="50% 截断 tool 参数"
              />
              <div
                className="absolute top-0 h-2 w-px bg-destructive/80"
                style={{ left: `${summarizePct}%` }}
                title="75% LLM 摘要"
              />
            </div>
            {budget?.last_output_tokens != null && (
              <p className="text-xs text-muted-foreground">
                上轮输出 {formatTokenCount(budget.last_output_tokens)} tokens
              </p>
            )}
            {budget?.usage_percent_of_summarize != null && (
              <p className="text-xs text-muted-foreground">
                距摘要阈值{" "}
                {budget.usage_percent_of_summarize >= 100
                  ? "已超过"
                  : `还有 ${formatTokenCount(
                      Math.max(
                        0,
                        (budget.summarization_threshold ?? 0) - used
                      )
                    )}`}
                （摘要线 {formatTokenCount(budget.summarization_threshold)}）
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {budget?.source === "estimated"
              ? "模型未返回 usage，已根据对话内容本地估算 token 数。"
              : budget?.source === "api_usage"
                ? "数据来自上一轮 assistant 消息的模型 API 统计。"
                : "首轮 assistant 回复完成后显示用量。"}
          </p>
        )}

        <div className="space-y-1 border-t pt-2 text-[11px] text-muted-foreground">
          <p>50%：截断旧 write_file / execute 参数</p>
          <p>75%：LLM 摘要中间段（自动压缩）</p>
          <p>80%×75%：跳过 DB 无脑丢中间，改走摘要</p>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
