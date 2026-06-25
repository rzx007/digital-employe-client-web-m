import * as React from "react"
import { cn } from "@workspace/ui/lib/utils"

/**
 * 所有 widget 的统一底盘:同样的圆角/边/阴影/表头节奏。
 * 层次靠"画布底色 + 卡片轻微高度差"建立,而非边框粗细或装饰。
 */
export function WidgetCard({
  title,
  subtitle,
  action,
  className,
  bodyClassName,
  children,
}: {
  title: string
  subtitle?: string
  action?: React.ReactNode
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-xl border border-border/70 bg-card",
        "shadow-xs transition-shadow duration-200 hover:shadow-sm",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2 px-4 pb-2 pt-3.5">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold tracking-tight text-foreground">
            {title}
          </h3>
          {subtitle ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className={cn("min-h-0 flex-1 px-4 pb-4", bodyClassName)}>{children}</div>
    </div>
  )
}

/** widget 内统一的空态 */
export function WidgetEmpty({ label = "暂无数据" }: { label?: string }) {
  return (
    <div className="flex h-full min-h-16 items-center justify-center text-xs text-muted-foreground">
      {label}
    </div>
  )
}
