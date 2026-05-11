"use client"

import { cn } from "@workspace/ui/lib/utils"

function humanCron(cron: string | null | undefined): string | null {
  if (!cron) return null
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return cron
  const [min, hour, day, month, week] = parts
  if (week !== "*") {
    const days = ["日", "一", "二", "三", "四", "五", "六"]
    const dayNames = week
      .split(",")
      .map((d) => days[Number(d)] ?? d)
      .join("、")
    return `每周${dayNames} ${hour}:${min}`
  }
  if (day !== "*") return `每月${day}日 ${hour}:${min}`
  return `每天 ${hour}:${min}`
}

export function CronPreviewBadge({
  cron,
  className,
}: {
  cron?: string | null
  className?: string
}) {
  const text = humanCron(cron)
  if (!text) return null

  return (
    <span
      className={cn(
        "shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground",
        className
      )}
    >
      {text}
    </span>
  )
}
