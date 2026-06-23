import { useState } from "react"
import { IconCalendar } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import {
  useMonthlyScheduleOverview,
  useTodayAllExecutions,
} from "@/hooks/use-schedule-monitor-queries"
import { ScheduleCalendar } from "@/components/schedule-monitor/sections/schedule-calendar"
import { TodayTaskList } from "./today-task-list"
import { WorkbenchPerformanceSection } from "./workbench-performance-section"
import { WorkbenchShiftCalendarSheet } from "./workbench-shift-calendar-sheet"

export function WorkbenchLeftPanel() {
  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1)
  const [shiftCalendarOpen, setShiftCalendarOpen] = useState(false)

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

          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-muted-foreground">日程</div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
              onClick={() => setShiftCalendarOpen(true)}
            >
              <IconCalendar className="size-3.5" />
              员工排班
            </Button>
          </div>

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

      <WorkbenchShiftCalendarSheet
        open={shiftCalendarOpen}
        onOpenChange={setShiftCalendarOpen}
      />
    </div>
  )
}
