import { useMemo } from "react"
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@workspace/ui/components/hover-card"
import type { MonthlyOverview, ScheduleDay } from "@/types/schedule-monitor"

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"]

function formatHoverDateLabel(dateStr: string): string {
  const parts = dateStr.split("-").map(Number)
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    return dateStr
  }
  const [year, month, day] = parts
  const d = new Date(year, month - 1, day)
  const w = WEEKDAY_LABELS[(d.getDay() + 6) % 7]
  return `${month}月${day}日 周${w}`
}

function countDayTasks(dayData: ScheduleDay): number {
  return dayData.runs.length
}

function ScheduleDayHoverContent({
  dateStr,
  dayData,
}: {
  dateStr: string
  dayData: ScheduleDay
}) {
  const totalRuns = countDayTasks(dayData)
  return (
    <div className="flex flex-col gap-0">
      <p className="text-[11px] leading-snug font-medium text-foreground">
        {formatHoverDateLabel(dateStr)}
      </p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        {totalRuns} 次运行
      </p>
      <ul className="mt-1.5 max-h-32 space-y-1 overflow-y-auto border-t border-border/50 pt-1.5">
        {dayData.runs.map((run) => (
          <li
            key={`${run.plan_id}-${run.time}`}
            className="flex items-center justify-between gap-2 text-[10px]"
          >
            <span className="min-w-0 truncate font-medium text-foreground">
              {run.title}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <span className="text-muted-foreground tabular-nums">
                {run.time}
              </span>
              <span
                className={cn(
                  "rounded-md px-1.5 py-px",
                  run.schedule_kind === "recurring"
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {run.schedule_kind === "recurring" ? "循环" : "单次"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function getLevel(dayData: ScheduleDay): 0 | 1 | 2 | 3 {
  const totalRuns = dayData.runs.length
  if (totalRuns === 0) return 0
  if (totalRuns <= 5) return 1
  if (totalRuns <= 8) return 2
  return 3
}

const LEVEL_COLORS: Record<number, string> = {
  0: "bg-muted-foreground/10 border-muted-foreground/10",
  1: "bg-emerald-200 border-emerald-300 dark:bg-emerald-900/70 dark:border-emerald-800/70",
  2: "bg-emerald-400 border-emerald-500 dark:bg-emerald-600/70 dark:border-emerald-500/70",
  3: "bg-emerald-600 border-emerald-700 dark:bg-emerald-800/70 dark:border-emerald-700/70",
}

function getCalendarGrid(year: number, month: number) {
  const firstDay = new Date(year, month - 1, 1)
  const lastDay = new Date(year, month, 0)
  const startWeekday = (firstDay.getDay() + 6) % 7
  const totalDays = lastDay.getDate()

  const cells: (number | null)[] = []
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let d = 1; d <= totalDays; d++) cells.push(d)

  return cells
}

function formatDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

export function ScheduleCalendar({
  overview,
  onMonthChange,
}: {
  overview: MonthlyOverview
  onMonthChange: (year: number, month: number) => void
}) {
  const cells = useMemo(
    () => getCalendarGrid(overview.year, overview.month),
    [overview.year, overview.month]
  )

  const dayMap = useMemo(() => {
    return new Map<string, ScheduleDay>(Object.entries(overview.days))
  }, [overview.days])

  const today = new Date()
  const todayStr = formatDateStr(
    today.getFullYear(),
    today.getMonth() + 1,
    today.getDate()
  )

  const monthNames = [
    "1月",
    "2月",
    "3月",
    "4月",
    "5月",
    "6月",
    "7月",
    "8月",
    "9月",
    "10月",
    "11月",
    "12月",
  ]

  const handlePrev = () => {
    let m = overview.month - 1
    let y = overview.year
    if (m < 1) {
      m = 12
      y -= 1
    }
    onMonthChange(y, m)
  }

  const handleNext = () => {
    let m = overview.month + 1
    let y = overview.year
    if (m > 12) {
      m = 1
      y += 1
    }
    onMonthChange(y, m)
  }

  // const futureLimit = new Date(today.getFullYear(), today.getMonth() + 1, 1)

  // const canGoNext = new Date(overview.year, overview.month, 1) < futureLimit

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground">排班概览</h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6"
            onClick={handlePrev}
          >
            <IconChevronLeft className="size-3.5" />
          </Button>
          <span className="min-w-[90px] text-center text-xs font-medium">
            {overview.year}年 {monthNames[overview.month - 1]}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6"
            onClick={handleNext}
          >
            <IconChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="mb-1 grid grid-cols-7 justify-items-center gap-x-1 gap-y-1">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="text-center text-[10px] text-muted-foreground"
          >
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 justify-items-center gap-x-1 gap-y-1">
        {cells.map((day, i) => {
          if (day == null) {
            return <div key={`empty-${i}`} />
          }

          const dateStr = formatDateStr(overview.year, overview.month, day)
          const dayData = dayMap.get(dateStr)
          const level = dayData ? getLevel(dayData) : 0
          const isToday = dateStr === todayStr
          const hasSchedule = dayData && dayData.runs.length > 0

          const buttonProps = {
            type: "button" as const,
            disabled: !dayData || !hasSchedule,
            className: cn(
              "size-4 rounded-sm border transition-colors",
              LEVEL_COLORS[level],
              isToday &&
                "ring-1 ring-ring ring-offset-1 ring-offset-background",
              dayData && !hasSchedule && "cursor-default opacity-30",
              hasSchedule && "cursor-pointer hover:opacity-80"
            ),
            children: <span className="sr-only">{day}</span>,
          }

          if (hasSchedule && dayData) {
            const totalRuns = countDayTasks(dayData)
            const hoverTitle = `${formatHoverDateLabel(dateStr)} · ${totalRuns} 次运行`
            return (
              <HoverCard key={dateStr} openDelay={120} closeDelay={80}>
                <HoverCardTrigger asChild>
                  <button {...buttonProps} title={hoverTitle} />
                </HoverCardTrigger>
                <HoverCardContent
                  side="top"
                  align="center"
                  className="w-[min(100vw-1.5rem,260px)] max-w-xs p-2.5"
                >
                  <ScheduleDayHoverContent
                    dateStr={dateStr}
                    dayData={dayData}
                  />
                </HoverCardContent>
              </HoverCard>
            )
          }

          return <button key={dateStr} {...buttonProps} />
        })}
      </div>

      <div className="mt-2 flex items-center justify-end gap-3">
        <div className="flex items-center gap-1">
          <span className="size-2.5 rounded-sm bg-muted-foreground/8" />
          <span className="text-[10px] text-muted-foreground">无</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="size-2.5 rounded-sm bg-emerald-50 dark:bg-emerald-950/40" />
          <span className="text-[10px] text-muted-foreground">少</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="size-2.5 rounded-sm bg-emerald-100 dark:bg-emerald-900/35" />
          <span className="text-[10px] text-muted-foreground">中</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="size-2.5 rounded-sm bg-emerald-200 dark:bg-emerald-800/45" />
          <span className="text-[10px] text-muted-foreground">多</span>
        </div>
      </div>
    </div>
  )
}
