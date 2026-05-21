"use client"

import * as React from "react"
import { memo } from "react"
import { IconCircleCheck } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { EmployeeContactAvatar } from "@/components/chat/contacts/contact-avatars"
import { createDiceBearAvatar } from "@/lib/avatar"
import { fireRealisticConfetti } from "@/lib/celebration/realistic-confetti"
import {
  isRecruitmentToolRunning,
  parseEmployeeHiredPayload,
} from "@/lib/chat/recruitment-tool-payload"

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
    () => parseEmployeeHiredPayload(resultText),
    [resultText]
  )

  const employeeId = payload?.employee_id
  const avatarSrc = React.useMemo(
    () =>
      employeeId != null ? createDiceBearAvatar(String(employeeId)) : undefined,
    [employeeId]
  )

  const wasRunningRef = React.useRef(false)

  const isRunning = isRecruitmentToolRunning(state ?? "")
  const isError = state === "output-error"
  const isSuccess =
    state === "output-available" && payload != null && !isRunning && !isError

  React.useEffect(() => {
    const justCompleted =
      wasRunningRef.current && isSuccess && payload != null
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
        <p className="mt-1 line-clamp-4 break-words text-xs leading-relaxed text-destructive/80">
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
        <div className="flex items-start gap-3">
          <EmployeeContactAvatar
            name={payload.employee_name}
            avatar={avatarSrc}
            avatarClassName="size-11 rounded-lg"
            fallbackClassName="rounded-lg bg-primary/10 text-sm font-medium text-primary"
          />
          <div className="min-w-0 flex-1 overflow-hidden">
            <p
              className="truncate text-sm font-medium"
              title={payload.employee_name}
            >
              {payload.employee_name}
            </p>
            <p
              className="mt-0.5 truncate text-[11px] text-muted-foreground"
              title={
                payload.employee_code
                  ? `员工 ID ${payload.employee_id} · ${payload.employee_code}`
                  : `员工 ID ${payload.employee_id}`
              }
            >
              员工 ID {payload.employee_id}
              {payload.employee_code
                ? ` · ${payload.employee_code}`
                : null}
            </p>
            {payload.message && (
              <p
                className="mt-1 line-clamp-3 break-words text-xs leading-relaxed text-muted-foreground"
                title={payload.message}
              >
                {payload.message}
              </p>
            )}
            {payload.skills.length > 0 && (
              <div className="mt-2 flex max-w-full flex-wrap gap-1">
                {payload.skills.map((skill) => (
                  <Badge
                    key={skill}
                    variant="outline"
                    className="max-w-full truncate text-[10px] font-normal"
                    title={skill}
                  >
                    {skill}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export const EmployeeHiredCard = memo(EmployeeHiredCardInner)
