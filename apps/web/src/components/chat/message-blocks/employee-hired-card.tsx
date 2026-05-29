"use client"

import * as React from "react"
import { memo } from "react"
import { IconCircleCheck } from "@tabler/icons-react"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { fireRealisticConfetti } from "@/lib/celebration/realistic-confetti"
import {
  isRecruitmentToolRunning,
  parseEmployeeHiredPayload,
  type EmployeeHiredPayload,
} from "@/lib/chat/recruitment-tool-payload"
import { EmployeeHiredPreview } from "./employee-hired-preview"

/** 工牌宽度：对话内不占满行，窄侧栏下仍可收缩 */
const HIRED_CARD_LAYOUT =
  "relative self-start w-full max-w-sm min-w-0 overflow-hidden rounded-lg border bg-card p-3 text-sm"

const STATE_CONFIG: Record<string, { title: string; titleClass: string }> = {
  call: {
    title: "正在办理入职...",
    titleClass: "text-muted-foreground animate-pulse",
  },
  "input-streaming": {
    title: "正在办理入职...",
    titleClass: "text-muted-foreground animate-pulse",
  },
  "input-available": {
    title: "正在办理入职...",
    titleClass: "text-muted-foreground animate-pulse",
  },
  "output-available": {
    title: "入职成功",
    titleClass: "text-foreground",
  },
  "output-error": {
    title: "入职失败",
    titleClass: "text-destructive",
  },
}

function HiredSkeleton() {
  return (
    <div className="flex items-start gap-3">
      <Skeleton className="size-11 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-20" />
        <div className="flex gap-1">
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      </div>
    </div>
  )
}

function EmployeeHiredCardInner({
  state,
  resultText,
  celebrateOnSuccess = false,
  className,
}: {
  state?: string
  resultText?: string | null
  /** 当前轮最后一条 assistant 消息内录用成功时允许庆祝 */
  celebrateOnSuccess?: boolean
  className?: string
}) {
  const payload = React.useMemo(
    (): EmployeeHiredPayload | null => parseEmployeeHiredPayload(resultText),
    [resultText]
  )

  const wasRunningRef = React.useRef(false)

  const isRunning = isRecruitmentToolRunning(state ?? "")
  const isError = state === "output-error"
  const isSuccess =
    state === "output-available" && payload != null && !isRunning && !isError

  React.useEffect(() => {
    const justCompleted = wasRunningRef.current && isSuccess && payload != null
    wasRunningRef.current = isRunning

    if (!justCompleted || !celebrateOnSuccess) return
    fireRealisticConfetti()
  }, [isRunning, isSuccess, payload, celebrateOnSuccess])
  const plainError =
    !payload &&
    !isRunning &&
    resultText?.trim() &&
    !resultText.trim().startsWith("{")

  if (plainError) {
    return (
      <div
        className={cn(
          HIRED_CARD_LAYOUT,
          "border-destructive/40 bg-destructive/5",
          className
        )}
      >
        <p className="text-xs font-semibold text-destructive">入职失败</p>
        <p className="mt-1 line-clamp-4 text-xs leading-relaxed break-words text-destructive/80">
          {resultText}
        </p>
      </div>
    )
  }

  if (!payload && !isRunning) return null

  const cfg = STATE_CONFIG[state ?? ""] ?? STATE_CONFIG["output-available"]

  return (
    <div
      className={cn(
        HIRED_CARD_LAYOUT,
        isError && "border-destructive/40",
        className
      )}
    >
      <div className="mb-2 flex items-center gap-1.5">
        {!isRunning && !isError && (
          <IconCircleCheck className="size-3.5 shrink-0 text-green-600 dark:text-green-400" />
        )}
        <p className={cn("text-xs font-semibold", cfg.titleClass)}>
          {cfg.title}
        </p>
      </div>

      {isRunning ? (
        <HiredSkeleton />
      ) : payload ? (
        <EmployeeHiredPreview
          employeeId={payload.employee_id}
          employeeName={payload.employee_name}
          employeeCode={payload.employee_code}
          skills={payload.skills}
          message={payload.message}
          className="border-0 bg-transparent p-0"
        />
      ) : null}
    </div>
  )
}

export const EmployeeHiredCard = memo(EmployeeHiredCardInner)
