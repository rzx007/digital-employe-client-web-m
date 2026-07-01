"use client"

import * as React from "react"
import { memo, useCallback } from "react"
import { IconCircleCheck } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { useCuratorRecruitment } from "@/components/chat/curator/use-curator-recruitment"
import {
  isRecruitmentToolRunning,
  parseRecruitmentCandidatesPayload,
} from "@/lib/chat/recruitment-tool-payload"
import { RecruitmentCandidateBadge } from "./recruitment-candidate-badge"

const STATE_CONFIG: Record<string, { title: string; titleClass: string }> = {
  call: {
    title: "正在生成候选人...",
    titleClass: "text-muted-foreground animate-pulse",
  },
  "input-streaming": {
    title: "正在生成候选人...",
    titleClass: "text-muted-foreground animate-pulse",
  },
  "input-available": {
    title: "正在生成候选人...",
    titleClass: "text-muted-foreground animate-pulse",
  },
  "output-available": {
    title: "招聘候选人",
    titleClass: "text-foreground",
  },
  "output-error": {
    title: "招聘失败",
    titleClass: "text-destructive",
  },
}

/** 按卡片容器宽度响应（CuratorView compact ~360px 保持单列） */
const CANDIDATES_GRID =
  "grid grid-cols-1 gap-2 @[26rem]/recruitment:grid-cols-2 @[26rem]/recruitment:gap-3"

const CARD_SHELL =
  "@container/recruitment relative w-full min-w-0 overflow-hidden rounded-lg border bg-card p-2.5 text-sm @[22rem]/recruitment:p-3"

function CandidateSkeletons() {
  return (
    <div className={CANDIDATES_GRID}>
      {[0, 1].map((i) => (
        <div
          key={i}
          className="rounded-lg border bg-card p-2.5 @[22rem]/recruitment:p-3"
        >
          <div className="flex gap-2 @[22rem]/recruitment:gap-2.5">
            <Skeleton className="size-8 shrink-0 rounded-lg @[22rem]/recruitment:size-9" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
              <div className="flex gap-1">
                <Skeleton className="h-5 w-14 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function RecruitmentCandidatesCardInner({
  state,
  resultText,
  preliminary,
  className,
}: {
  state?: string
  resultText?: string | null
  preliminary?: boolean
  className?: string
}) {
  const recruitment = useCuratorRecruitment()
  const payload = React.useMemo(
    () => parseRecruitmentCandidatesPayload(resultText),
    [resultText]
  )

  const handleHireAll = useCallback(() => {
    if (!payload?.candidates.length || !recruitment?.onHireAll) return
    recruitment.onHireAll(payload.candidates)
  }, [payload, recruitment])

  const isPending = isRecruitmentToolRunning(state ?? "", preliminary)
  const isError = state === "output-error"
  const plainError =
    !isPending &&
    !payload &&
    resultText?.trim() &&
    !resultText.trim().startsWith("{")

  if (plainError) {
    return (
      <div
        className={cn(
          "@container/recruitment w-full min-w-0 rounded-lg border border-destructive/40 bg-destructive/5 px-2.5 py-2 text-sm @[22rem]/recruitment:px-3 @[22rem]/recruitment:py-2.5",
          className
        )}
      >
        <p className="text-xs font-semibold text-destructive">招聘失败</p>
        <p className="mt-1 text-xs leading-relaxed text-destructive/80">
          {resultText}
        </p>
      </div>
    )
  }

  if (!payload && !isPending) return null

  const cfg = isPending
    ? STATE_CONFIG["input-available"]
    : (STATE_CONFIG[state ?? ""] ?? STATE_CONFIG["output-available"])

  return (
    <div
      className={cn(CARD_SHELL, isError && "border-destructive/40", className)}
    >
      <div className="mb-2 flex flex-col gap-1.5 @[18rem]/recruitment:mb-2.5 @[18rem]/recruitment:flex-row @[18rem]/recruitment:items-start @[18rem]/recruitment:justify-between @[18rem]/recruitment:gap-2">
        <div className="min-w-0 flex-1">
          <p className={cn("text-xs font-semibold", cfg.titleClass)}>
            {cfg.title}
          </p>
          {payload?.hint && !isPending && (
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/80">
              {payload.hint}
            </p>
          )}
        </div>
        {payload && !isPending && (
          <span className="w-fit shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {payload.total} 位候选人
          </span>
        )}
      </div>

      {isPending ? (
        <CandidateSkeletons />
      ) : payload ? (
        <div className={CANDIDATES_GRID}>
          {payload.candidates.map((candidate) => (
            <RecruitmentCandidateBadge
              key={`${candidate.index}-${candidate.name}`}
              candidate={candidate}
            />
          ))}
        </div>
      ) : null}

      {payload &&
      payload.candidates.length >= 2 &&
      !isPending &&
      recruitment?.onHireAll ? (
        <div className="mt-2 @[18rem]/recruitment:mt-2.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 w-full gap-1.5 text-xs"
            disabled={recruitment.hireDisabled}
            onClick={handleHireAll}
          >
            <IconCircleCheck className="size-3.5" />
            全部录用 ({payload.candidates.length} 人)
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export const RecruitmentCandidatesCard = memo(RecruitmentCandidatesCardInner)
