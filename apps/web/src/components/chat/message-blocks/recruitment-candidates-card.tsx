"use client"

import * as React from "react"
import { memo } from "react"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
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

function CandidateSkeletons() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {[0, 1].map((i) => (
        <div key={i} className="rounded-lg border bg-card p-3">
          <div className="flex gap-2.5">
            <Skeleton className="size-9 shrink-0 rounded-lg" />
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
  className,
}: {
  state?: string
  resultText?: string | null
  className?: string
}) {
  const payload = React.useMemo(
    () => parseRecruitmentCandidatesPayload(resultText),
    [resultText]
  )

  const isRunning = isRecruitmentToolRunning(state ?? "")
  const isError = state === "output-error"
  const plainError =
    !payload &&
    !isRunning &&
    resultText?.trim() &&
    !resultText.trim().startsWith("{")

  if (plainError) {
    return (
      <div
        className={cn(
          "rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm",
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

  if (!payload && !isRunning) return null

  const cfg =
    STATE_CONFIG[state ?? ""] ?? STATE_CONFIG["output-available"]

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border bg-card p-3 text-sm",
        isError && "border-destructive/40",
        className
      )}
    >
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className={cn("text-xs font-semibold", cfg.titleClass)}>
            {cfg.title}
          </p>
          {payload?.hint && !isRunning && (
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/80">
              {payload.hint}
            </p>
          )}
        </div>
        {payload && !isRunning && (
          <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {payload.total} 位候选人
          </span>
        )}
      </div>

      {isRunning ? (
        <CandidateSkeletons />
      ) : payload ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {payload.candidates.map((candidate) => (
            <RecruitmentCandidateBadge
              key={`${candidate.index}-${candidate.name}`}
              candidate={candidate}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export const RecruitmentCandidatesCard = memo(RecruitmentCandidatesCardInner)
