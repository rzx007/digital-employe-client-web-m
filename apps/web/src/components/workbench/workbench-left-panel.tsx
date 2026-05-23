import { useState } from "react"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import {
  useMonthlyScheduleOverview,
  useTodayAllExecutions,
} from "@/hooks/use-schedule-monitor-queries"
import { ScheduleCalendar } from "@/components/schedule-monitor/sections/schedule-calendar"
import { TodayTaskList } from "./today-task-list"
import { PerformanceMetricsCard } from "./performance-metrics-card"

export function WorkbenchLeftPanel() {
  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1)

  const { data: overview, isLoading: isOverviewLoading } =
    useMonthlyScheduleOverview(viewYear, viewMonth)
  const { data: executions = [], isLoading: isExecutionsLoading } =
    useTodayAllExecutions()

  const handleMonthChange = (year: number, month: number) => {
    setViewYear(year)
    setViewMonth(month)
  }

  return (
    <div className="flex h-full w-[320px] shrink-0 flex-col border-r">
      <ScrollArea className="min-h-0 flex-1 p-3">
        <div className="flex flex-col gap-3">
          <div className="text-xs font-medium text-muted-foreground">
            考核指标
          </div>
          <PerformanceMetricsCard compact />

          <div className="text-xs font-medium text-muted-foreground">日程</div>

          {overview && (
            <ScheduleCalendar
              overview={overview}
              onMonthChange={handleMonthChange}
            />
          )}

          <div className="text-xs font-medium text-muted-foreground">
            今日任务
          </div>

          <TodayTaskList
            executions={executions}
            isLoading={isExecutionsLoading}
          />
        </div>
      </ScrollArea>
    </div>
  )
}
