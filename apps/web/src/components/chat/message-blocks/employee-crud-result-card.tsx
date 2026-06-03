"use client"

import * as React from "react"
import { memo } from "react"
import {
  IconCircleCheck,
  IconTrash,
  IconUserSearch,
} from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import {
  MorphingDialog,
  MorphingDialogClose,
  MorphingDialogContainer,
  MorphingDialogContent,
  MorphingDialogDescription,
  MorphingDialogTitle,
  MorphingDialogTrigger,
} from "@workspace/ui/components/morphing-dialog"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { formatErrorDisplayText } from "@/lib/chat/message-classifier"
import {
  isEmployeeCrudToolRunning,
  mcpLabelsFromDetailMcps,
  parseEmployeeDeletedPayload,
  parseEmployeeDetailPayload,
  parseEmployeeUpdatedPayload,
  skillLabelsFromDetailSkills,
  type EmployeeDetailPayload,
  type EmployeeUpdatedPayload,
} from "@/lib/chat/employee-crud-tool-payload"
import { EmployeeHiredPreview } from "./employee-hired-preview"

const CARD_SHELL =
  "relative w-full min-w-0 max-w-sm self-start overflow-hidden rounded-lg border bg-card p-3 text-sm"

const EXPAND_TRIGGER =
  "w-full min-w-0 rounded-lg border-0 bg-transparent p-0 text-left transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

const MODAL_CONTENT =
  "relative w-[min(100vw-2rem,28rem)] max-h-[min(85vh,32rem)] overflow-y-auto rounded-xl border bg-card p-5 shadow-lg"

const VARIANT_CONFIG = {
  detail: {
    title: "员工详情",
    runningTitle: "正在查询员工...",
    icon: IconUserSearch,
    titleClass: "text-foreground",
  },
  updated: {
    title: "员工已更新",
    runningTitle: "正在更新员工...",
    icon: IconCircleCheck,
    titleClass: "text-foreground",
  },
  deleted: {
    title: "员工已解聘",
    runningTitle: "正在解聘员工...",
    icon: IconTrash,
    titleClass: "text-destructive",
  },
} as const

function CrudSkeleton() {
  return (
    <div className="flex items-start gap-3">
      <Skeleton className="size-11 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-full" />
      </div>
    </div>
  )
}

function SkillBadgeList({
  labels,
  max,
  className,
}: {
  labels: string[]
  max?: number
  className?: string
}) {
  if (labels.length === 0) return null
  const visible = max != null ? labels.slice(0, max) : labels
  const remaining = max != null ? labels.length - visible.length : 0

  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {visible.map((label) => (
        <Badge
          key={label}
          variant="outline"
          className="max-w-full truncate text-[10px] font-normal"
          title={label}
        >
          {label}
        </Badge>
      ))}
      {remaining > 0 && (
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          +{remaining}
        </Badge>
      )}
    </div>
  )
}

function CrudCardHeader({
  variant,
  isRunning,
  isError,
  isCurator,
}: {
  variant: "detail" | "updated"
  isRunning: boolean
  isError: boolean
  isCurator?: boolean
}) {
  const cfg = VARIANT_CONFIG[variant]
  const Icon = cfg.icon

  return (
    <div className="mb-2 flex items-center gap-1.5">
      {!isRunning && !isError && (
        <Icon className="size-3.5 shrink-0 text-green-600 dark:text-green-400" />
      )}
      <p
        className={cn(
          "text-xs font-semibold",
          isRunning ? "text-muted-foreground animate-pulse" : cfg.titleClass
        )}
      >
        {isRunning ? cfg.runningTitle : cfg.title}
      </p>
      {isCurator && !isRunning && (
        <Badge variant="secondary" className="ml-auto text-[10px]">
          总管
        </Badge>
      )}
    </div>
  )
}

function EmployeeDetailExpandable({
  payload,
  skillLabels,
  mcpLabels,
  className,
}: {
  payload: EmployeeDetailPayload
  skillLabels: string[]
  mcpLabels: string[]
  className?: string
}) {
  return (
    <MorphingDialog transition={{ type: "spring", bounce: 0, duration: 0.28 }}>
      <div className={cn(CARD_SHELL, className)}>
        <CrudCardHeader variant="detail" isRunning={false} isError={false} isCurator={payload.is_curator} />
        <MorphingDialogTrigger
          className={EXPAND_TRIGGER}
          aria-label={`查看员工 ${payload.employee_name} 详情`}
        >
          <div className="space-y-2">
            <EmployeeHiredPreview
              employeeId={payload.employee_id}
              employeeName={payload.employee_name}
              employeeCode={payload.employee_code}
              skills={skillLabels}
              compact
              className="border-0 bg-transparent p-0"
            />
            {payload.description ? (
              <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {payload.description}
              </p>
            ) : null}
            <p className="text-[10px] text-muted-foreground/80">点击查看详情</p>
          </div>
        </MorphingDialogTrigger>
      </div>
      <MorphingDialogContainer>
        <MorphingDialogContent className={MODAL_CONTENT}>
          <MorphingDialogClose className="top-4 right-4 size-8" />
          <div className="space-y-4 pr-6">
            <div className="flex items-start justify-between gap-2">
              <MorphingDialogTitle className="text-base leading-tight font-semibold">
                {payload.employee_name}
              </MorphingDialogTitle>
              {payload.is_curator && (
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  总管
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              员工 ID {payload.employee_id}
              {payload.employee_code ? ` · ${payload.employee_code}` : ""}
            </p>
            <MorphingDialogDescription
              disableLayoutAnimation
              className="text-sm leading-relaxed text-muted-foreground"
            >
              <p className="wrap-break-word whitespace-pre-wrap">
                {payload.description || "暂无描述"}
              </p>
            </MorphingDialogDescription>
            <div>
              <p className="mb-1.5 text-xs font-medium text-foreground">技能</p>
              {skillLabels.length > 0 ? (
                <SkillBadgeList labels={skillLabels} />
              ) : (
                <p className="text-xs text-muted-foreground">暂未配置技能</p>
              )}
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-foreground">
                外接能力 (MCP)
              </p>
              {mcpLabels.length > 0 ? (
                <SkillBadgeList labels={mcpLabels} />
              ) : (
                <p className="text-xs text-muted-foreground">暂未配置 MCP</p>
              )}
            </div>
          </div>
        </MorphingDialogContent>
      </MorphingDialogContainer>
    </MorphingDialog>
  )
}

function EmployeeUpdatedExpandable({
  payload,
  className,
}: {
  payload: EmployeeUpdatedPayload
  className?: string
}) {
  return (
    <MorphingDialog transition={{ type: "spring", bounce: 0, duration: 0.28 }}>
      <div className={cn(CARD_SHELL, className)}>
        <CrudCardHeader variant="updated" isRunning={false} isError={false} />
        <MorphingDialogTrigger
          className={EXPAND_TRIGGER}
          aria-label={`查看员工 ${payload.employee_name} 更新详情`}
        >
          <div className="space-y-2">
            <EmployeeHiredPreview
              employeeId={payload.employee_id}
              employeeName={payload.employee_name}
              skills={payload.skills}
              compact
              className="border-0 bg-transparent p-0"
            />
            {payload.message ? (
              <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {payload.message}
              </p>
            ) : null}
            <p className="text-[10px] text-muted-foreground/80">点击查看详情</p>
          </div>
        </MorphingDialogTrigger>
      </div>
      <MorphingDialogContainer>
        <MorphingDialogContent className={MODAL_CONTENT}>
          <MorphingDialogClose className="top-4 right-4 size-8" />
          <div className="space-y-4 pr-6">
            <MorphingDialogTitle className="text-base leading-tight font-semibold">
              {payload.employee_name}
            </MorphingDialogTitle>
            <p className="text-xs text-muted-foreground">
              员工 ID {payload.employee_id}
            </p>
            {payload.message && (
              <MorphingDialogDescription
                disableLayoutAnimation
                className="text-sm leading-relaxed text-muted-foreground"
              >
                {payload.message}
              </MorphingDialogDescription>
            )}
            <div>
              <p className="mb-1.5 text-xs font-medium text-foreground">
                当前技能
              </p>
              {payload.skills.length > 0 ? (
                <SkillBadgeList labels={payload.skills} />
              ) : (
                <p className="text-xs text-muted-foreground">暂未配置技能</p>
              )}
            </div>
          </div>
        </MorphingDialogContent>
      </MorphingDialogContainer>
    </MorphingDialog>
  )
}

function EmployeeCrudResultCardInner({
  variant,
  state,
  resultText,
  preliminary,
  className,
}: {
  variant: keyof typeof VARIANT_CONFIG
  state?: string
  resultText?: string | null
  preliminary?: boolean
  className?: string
}) {
  const detailPayload = React.useMemo(
    () => parseEmployeeDetailPayload(resultText),
    [resultText]
  )
  const updatedPayload = React.useMemo(
    () => parseEmployeeUpdatedPayload(resultText),
    [resultText]
  )
  const deletedPayload = React.useMemo(
    () => parseEmployeeDeletedPayload(resultText),
    [resultText]
  )

  const isPending = isEmployeeCrudToolRunning(state ?? "", preliminary)
  const isError = state === "output-error"
  const cfg = VARIANT_CONFIG[variant]
  const Icon = cfg.icon

  const plainError =
    !isPending &&
    !detailPayload &&
    !updatedPayload &&
    !deletedPayload &&
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
        <p className="text-xs font-semibold text-destructive">操作失败</p>
        <p className="mt-1 line-clamp-4 text-xs leading-relaxed break-words text-destructive/80">
          {formatErrorDisplayText(resultText ?? "")}
        </p>
      </div>
    )
  }

  if (!detailPayload && !updatedPayload && !deletedPayload && !isPending) {
    return null
  }

  if (variant === "detail" && detailPayload && !isPending) {
    const skillLabels = skillLabelsFromDetailSkills(detailPayload.skills)
    const mcpLabels = mcpLabelsFromDetailMcps(detailPayload.mcps)
    return (
      <EmployeeDetailExpandable
        payload={detailPayload}
        skillLabels={skillLabels}
        mcpLabels={mcpLabels}
        className={className}
      />
    )
  }

  if (variant === "updated" && updatedPayload && !isPending) {
    return (
      <EmployeeUpdatedExpandable payload={updatedPayload} className={className} />
    )
  }

  return (
    <div
      className={cn(
        CARD_SHELL,
        (isError || variant === "deleted") && "border-destructive/30",
        className
      )}
    >
      <div className="mb-2 flex items-center gap-1.5">
        {!isPending && !isError && (
          <Icon
            className={cn(
              "size-3.5 shrink-0",
              variant === "deleted"
                ? "text-destructive"
                : "text-green-600 dark:text-green-400"
            )}
          />
        )}
        <p
          className={cn(
            "text-xs font-semibold",
            isPending ? "text-muted-foreground animate-pulse" : cfg.titleClass
          )}
        >
          {isPending ? cfg.runningTitle : cfg.title}
        </p>
        {detailPayload?.is_curator && !isPending && (
          <Badge variant="secondary" className="ml-auto text-[10px]">
            总管
          </Badge>
        )}
      </div>

      {isPending ? (
        <CrudSkeleton />
      ) : deletedPayload ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">{deletedPayload.employee_name}</p>
          <p className="text-[11px] text-muted-foreground">
            员工 ID {deletedPayload.employee_id}
          </p>
          {deletedPayload.message && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {deletedPayload.message}
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}

export const EmployeeDetailCard = memo(function EmployeeDetailCard(
  props: Omit<React.ComponentProps<typeof EmployeeCrudResultCardInner>, "variant">
) {
  return <EmployeeCrudResultCardInner {...props} variant="detail" />
})

export const EmployeeUpdatedCard = memo(function EmployeeUpdatedCard(
  props: Omit<React.ComponentProps<typeof EmployeeCrudResultCardInner>, "variant">
) {
  return <EmployeeCrudResultCardInner {...props} variant="updated" />
})

export const EmployeeDeletedCard = memo(function EmployeeDeletedCard(
  props: Omit<React.ComponentProps<typeof EmployeeCrudResultCardInner>, "variant">
) {
  return <EmployeeCrudResultCardInner {...props} variant="deleted" />
})
