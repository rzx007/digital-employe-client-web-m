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

function getLevel(dayData: ScheduleDay): 0 | 1 | 2 | 3 {
  const totalTasks = dayData.employees.reduce(
    (sum, emp) => sum + emp.tasks.length,
    0
  )
  if (totalTasks === 0) return 0
  if (totalTasks <= 5) return 1
  if (totalTasks <= 8) return 2
  return 3
}

function getDaySummary(dayData: ScheduleDay): string {
  const employeeNames = dayData.employees.map((e) => e.employee_name)
  const uniqueNames = [...new Set(employeeNames)]
  const totalTasks = dayData.employees.reduce(
    (sum, emp) => sum + emp.tasks.length,
    0
  )
  const employeePart =
    uniqueNames.length > 0 ? uniqueNames.join(", ") : "无排班"
  return `${totalTasks} 个任务 - ${employeePart}`
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

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"]

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
          const hasSchedule = dayData && dayData.employees.length > 0

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
            return (
              <HoverCard
                key={dateStr}
                openDelay={120}
                closeDelay={80}
              >
                <HoverCardTrigger asChild>
                  <button {...buttonProps} />
                </HoverCardTrigger>
                <HoverCardContent
                  side="top"
                  align="center"
                  className="w-auto max-w-xs text-[10px]"
                >
                  {`${dateStr}: ${getDaySummary(dayData)}`}
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
