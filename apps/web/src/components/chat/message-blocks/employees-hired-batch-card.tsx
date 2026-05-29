"use client"

import * as React from "react"
import { memo } from "react"
import { IconCircleCheck } from "@tabler/icons-react"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { fireRealisticConfetti } from "@/lib/celebration/realistic-confetti"
import {
  isRecruitmentToolRunning,
  parseEmployeesHiredPayload,
} from "@/lib/chat/recruitment-tool-payload"
import { EmployeeHiredPreview } from "./employee-hired-preview"

const BATCH_STATE_CONFIG: Record<string, { title: string; titleClass: string }> =
  {
    call: {
      title: "正在批量办理入职...",
      titleClass: "text-muted-foreground animate-pulse",
    },
    "input-streaming": {
      title: "正在批量办理入职...",
      titleClass: "text-muted-foreground animate-pulse",
    },
    "input-available": {
      title: "正在批量办理入职...",
      titleClass: "text-muted-foreground animate-pulse",
    },
    "output-available": {
      title: "批量入职",
      titleClass: "text-foreground",
    },
    "output-error": {
      title: "批量入职失败",
      titleClass: "text-destructive",
    },
  }

const HIRED_GRID =
  "grid grid-cols-1 gap-2 @[26rem]/recruitment:grid-cols-2 @[26rem]/recruitment:gap-3"

const CARD_SHELL =
  "@container/recruitment relative w-full min-w-0 overflow-hidden rounded-lg border bg-card p-2.5 text-sm @[22rem]/recruitment:p-3"

function BatchHiredSkeletons() {
  return (
    <div className={HIRED_GRID}>
      {[0, 1].map((i) => (
        <div
          key={i}
          className="rounded-lg border bg-card p-2.5 @[22rem]/recruitment:p-3"
        >
          <div className="flex gap-2.5">
            <Skeleton className="size-9 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function EmployeesHiredBatchCardInner({
  state,
  resultText,
  celebrateOnSuccess = false,
  className,
}: {
  state?: string
  resultText?: string | null
  celebrateOnSuccess?: boolean
  className?: string
}) {
  const payload = React.useMemo(
    () => parseEmployeesHiredPayload(resultText),
    [resultText]
  )

  const wasRunningRef = React.useRef(false)
  const isRunning = isRecruitmentToolRunning(state ?? "")
  const isError = state === "output-error"
  const hasSuccess = (payload?.succeeded.length ?? 0) > 0
  const isSuccess =
    state === "output-available" &&
    payload != null &&
    !isRunning &&
    !isError &&
    hasSuccess

  React.useEffect(() => {
    const justCompleted = wasRunningRef.current && isSuccess
    wasRunningRef.current = isRunning
    if (!justCompleted || !celebrateOnSuccess) return
    fireRealisticConfetti()
  }, [isRunning, isSuccess, celebrateOnSuccess])

  const plainError =
    !payload &&
    !isRunning &&
    resultText?.trim() &&
    !resultText.trim().startsWith("{")

  if (plainError) {
    return (
      <div
        className={cn(
          CARD_SHELL,
          "border-destructive/40 bg-destructive/5",
          className
        )}
      >
        <p className="text-xs font-semibold text-destructive">批量入职失败</p>
        <p className="mt-1 line-clamp-4 text-xs leading-relaxed break-words text-destructive/80">
          {resultText}
        </p>
      </div>
    )
  }

  if (!payload && !isRunning) return null

  const cfg =
    BATCH_STATE_CONFIG[state ?? ""] ?? BATCH_STATE_CONFIG["output-available"]
  const allFailed =
    payload != null && payload.succeeded_count === 0 && payload.failed_count > 0

  return (
    <div
      className={cn(
        CARD_SHELL,
        (isError || allFailed) && "border-destructive/40",
        className
      )}
    >
      <div className="mb-2 flex flex-col gap-1.5 @[18rem]/recruitment:mb-2.5 @[18rem]/recruitment:flex-row @[18rem]/recruitment:items-start @[18rem]/recruitment:justify-between @[18rem]/recruitment:gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {!isRunning && !isError && hasSuccess && (
              <IconCircleCheck className="size-3.5 shrink-0 text-green-600 dark:text-green-400" />
            )}
            <p className={cn("text-xs font-semibold", cfg.titleClass)}>
              {allFailed ? "批量入职失败" : cfg.title}
            </p>
          </div>
          {payload?.message && !isRunning && (
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {payload.message}
            </p>
          )}
        </div>
        {payload && !isRunning && (
          <span className="w-fit shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {payload.succeeded_count}/{payload.total} 已录用
          </span>
        )}
      </div>

      {isRunning ? (
        <BatchHiredSkeletons />
      ) : payload ? (
        <>
          {payload.succeeded.length > 0 && (
            <div className={HIRED_GRID}>
              {payload.succeeded.map((item) => (
                <EmployeeHiredPreview
                  key={`${item.index}-${item.employee_id}`}
                  employeeId={item.employee_id}
                  employeeName={item.employee_name}
                  employeeCode={item.employee_code}
                  skills={item.skills}
                  compact
                />
              ))}
            </div>
          )}
          {payload.failed.length > 0 && (
            <div
              className={cn(
                "space-y-1.5",
                payload.succeeded.length > 0 && "mt-3 border-t pt-3"
              )}
            >
              <p className="text-[11px] font-medium text-destructive">
                未录用 ({payload.failed_count})
              </p>
              <ul className="space-y-1">
                {payload.failed.map((item) => (
                  <li
                    key={`fail-${item.index}-${item.name ?? "unknown"}`}
                    className="rounded-md bg-destructive/5 px-2 py-1.5 text-[11px] leading-relaxed text-destructive/90"
                  >
                    {item.name ? (
                      <span className="font-medium">{item.name}: </span>
                    ) : null}
                    {item.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}

export const EmployeesHiredBatchCard = memo(EmployeesHiredBatchCardInner)
