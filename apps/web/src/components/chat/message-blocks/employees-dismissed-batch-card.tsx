"use client"

import * as React from "react"
import { memo } from "react"
import { IconCircleCheck, IconUserMinus } from "@tabler/icons-react"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import {
  isEmployeeDismissToolRunning,
  isEmployeesDismissedAllFailed,
  parseEmployeesDismissedPayload,
} from "@/lib/chat/employee-dismissed-tool-payload"

const BATCH_STATE_CONFIG: Record<
  string,
  { title: string; titleClass: string }
> = {
  call: {
    title: "正在批量解聘...",
    titleClass: "text-muted-foreground animate-pulse",
  },
  "input-streaming": {
    title: "正在批量解聘...",
    titleClass: "text-muted-foreground animate-pulse",
  },
  "input-available": {
    title: "正在批量解聘...",
    titleClass: "text-muted-foreground animate-pulse",
  },
  "output-available": {
    title: "批量解聘",
    titleClass: "text-foreground",
  },
  "output-error": {
    title: "批量解聘失败",
    titleClass: "text-destructive",
  },
}

const CARD_SHELL =
  "@container/dismiss relative w-full min-w-0 overflow-hidden rounded-lg border bg-card p-2.5 text-sm @[22rem]/dismiss:p-3"

function DismissSkeletons() {
  return (
    <div className="space-y-2">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="flex items-center gap-2 rounded-md border px-2 py-1.5"
        >
          <Skeleton className="size-4 shrink-0 rounded" />
          <Skeleton className="h-3.5 w-32" />
        </div>
      ))}
    </div>
  )
}

function EmployeesDismissedBatchCardInner({
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
  const payload = React.useMemo(
    () => parseEmployeesDismissedPayload(resultText),
    [resultText]
  )

  const isPending = isEmployeeDismissToolRunning(state ?? "", preliminary)
  const isError = state === "output-error"
  const hasSuccess = (payload?.succeeded.length ?? 0) > 0

  const plainError =
    !isPending &&
    !payload &&
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
        <p className="text-xs font-semibold text-destructive">批量解聘失败</p>
        <p className="mt-1 line-clamp-4 text-xs leading-relaxed wrap-break-word text-destructive/80">
          {resultText}
        </p>
      </div>
    )
  }

  if (!payload && !isPending) return null

  const cfg = isPending
    ? BATCH_STATE_CONFIG["input-available"]
    : (BATCH_STATE_CONFIG[state ?? ""] ?? BATCH_STATE_CONFIG["output-available"])
  const allFailed = !isPending && isEmployeesDismissedAllFailed(payload)

  return (
    <div
      className={cn(
        CARD_SHELL,
        (isError || allFailed) && "border-destructive/40",
        className
      )}
    >
      <div className="mb-2 flex flex-col gap-1.5 @[18rem]/dismiss:mb-2.5 @[18rem]/dismiss:flex-row @[18rem]/dismiss:items-start @[18rem]/dismiss:justify-between @[18rem]/dismiss:gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {!isPending && !isError && hasSuccess && (
              <IconCircleCheck className="size-3.5 shrink-0 text-green-600 dark:text-green-400" />
            )}
            <p className={cn("text-xs font-semibold", cfg.titleClass)}>
              {allFailed ? "批量解聘失败" : cfg.title}
            </p>
          </div>
          {payload?.message && !isPending && (
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {payload.message}
            </p>
          )}
        </div>
        {payload && !isPending && (
          <span className="w-fit shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {payload.succeeded_count}/{payload.total} 已解聘
          </span>
        )}
      </div>

      {isPending ? (
        <DismissSkeletons />
      ) : payload ? (
        <>
          {payload.succeeded.length > 0 && (
            <ul className="space-y-1.5">
              {payload.succeeded.map((item) => (
                <li
                  key={`${item.index}-${item.employee_id}`}
                  className="flex items-start gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-[11px]"
                >
                  <IconUserMinus className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      {item.employee_name || `员工 #${item.employee_id}`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {payload.failed.length > 0 && (
            <div
              className={cn(
                "space-y-1.5",
                payload.succeeded.length > 0 && "mt-3 border-t pt-3"
              )}
            >
              <p className="text-[11px] font-medium text-destructive">
                未解聘 ({payload.failed_count})
              </p>
              <ul className="space-y-1">
                {payload.failed.map((item) => (
                  <li
                    key={`fail-${item.index}-${item.employee_id ?? "unknown"}`}
                    className="rounded-md bg-destructive/5 px-2 py-1.5 text-[11px] leading-relaxed text-destructive/90"
                  >
                    {item.employee_id != null ? (
                      <span className="font-medium">
                        ID {item.employee_id}:{" "}
                      </span>
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

export const EmployeesDismissedBatchCard = memo(
  EmployeesDismissedBatchCardInner
)
