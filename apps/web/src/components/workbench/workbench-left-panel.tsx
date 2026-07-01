import { useState } from "react"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import {
  useMonthlyScheduleOverview,
  useTodayAllExecutions,
} from "@/hooks/use-schedule-monitor-queries"
import { ScheduleCalendar } from "@/components/schedule-monitor/sections/schedule-calendar"
import { TodayTaskList } from "./today-task-list"
import { WorkbenchPerformanceSection } from "./workbench-performance-section"

export function WorkbenchLeftPanel() {
  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1)

  const { data: overview } =
    useMonthlyScheduleOverview(viewYear, viewMonth)
  const { data: executions = [], isLoading: isExecutionsLoading } =
    useTodayAllExecutions()

  const handleMonthChange = (year: number, month: number) => {
    setViewYear(year)
    setViewMonth(month)
  }

  return (
    <div className="flex h-full w-[320px] shrink-0 flex-col border-r">
      <ScrollArea
        className={cn(
          "min-h-0 flex-1 p-3",
          // Radix viewport 子节点默认 table 布局会撑破宽度，导致内部 truncate 失效
          "[&_[data-slot=scroll-area-viewport]>div]:!block",
          "[&_[data-slot=scroll-area-viewport]>div]:!w-full",
          "[&_[data-slot=scroll-area-viewport]>div]:!min-w-0"
        )}
      >
        <div className="flex min-w-0 flex-col gap-3">
          <WorkbenchPerformanceSection />

          <div className="text-xs font-medium text-muted-foreground">日程</div>

          {overview && (
            <ScheduleCalendar
              overview={overview}
              onMonthChange={handleMonthChange}
            />
          )}

          <div className="min-w-0 overflow-hidden">
            <div className="text-xs font-medium text-muted-foreground">
              今日任务
            </div>
            <TodayTaskList
              executions={executions}
              isLoading={isExecutionsLoading}
            />
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
