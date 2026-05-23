import { useState } from "react"
import { cn } from "@workspace/ui/lib/utils"
import { ScrollArea } from "@workspace/ui/components/scroll-area"

import { useChatStore } from "@/stores/chat-store"
import { useMonitorStore } from "@/stores/monitor-store"
import {
  useExecutionMetrics7d,
  useMonthlyScheduleOverview,
  useTaskSummary,
  useTodayTaskRuns,
} from "@/hooks/use-schedule-monitor-queries"
import { MonitorHeader } from "./monitor-header"
import { EmployeeBasicInfo } from "./sections/employee-basic-info"
import { ScheduleCalendar } from "./sections/schedule-calendar"
import { TaskStatsCards } from "./sections/task-stats-cards"
import { ExecutionDetail } from "./sections/execution-detail"
import { ExecutionMetricsCard } from "./sections/execution-metrics-card"
import type { ChatViewContact } from "@/components/chat/shared/chat-view-shared"

export interface MonitorPanelProps {
  isOpen: boolean
  onClose: () => void
  className?: string
}

export function MonitorPanel({
  isOpen,
  onClose,
  className,
}: MonitorPanelProps) {
  const targetEmployeeId = useMonitorStore((s) => s.targetEmployeeId)
  const targetEmployeeName = useMonitorStore((s) => s.targetEmployeeName)
  const contacts = useChatStore((s) => s.contacts)

  const contact = targetEmployeeId
    ? contacts.find(
        (c) =>
          c.type === "employee" &&
          String(c.employee?.id) === String(targetEmployeeId)
      )
    : undefined

  const displayName = targetEmployeeName || "未知员工"

  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1)

  const { data: overview } = useMonthlyScheduleOverview(
    viewYear,
    viewMonth,
    targetEmployeeId
  )
  const { data: taskRuns = [] } = useTodayTaskRuns(targetEmployeeId)
  const { data: summary } = useTaskSummary(targetEmployeeId)
  const { data: executionMetrics } = useExecutionMetrics7d(targetEmployeeId)

  const handleMonthChange = (year: number, month: number) => {
    setViewYear(year)
    setViewMonth(month)
  }

  const employeeContact: ChatViewContact | undefined =
    contact?.type === "employee" ? contact : undefined

  if (!isOpen) return null

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-lg border bg-background shadow-xl",
        className
      )}
    >
      <MonitorHeader title={`任务监控 - ${displayName}`} onClose={onClose} />

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          <EmployeeBasicInfo contact={employeeContact} />

          {overview && (
            <ScheduleCalendar
              overview={overview}
              onMonthChange={handleMonthChange}
            />
          )}

          {summary && <TaskStatsCards summary={summary} />}

          <ExecutionMetricsCard metrics={executionMetrics} />

          <ExecutionDetail runs={taskRuns} />
        </div>
      </ScrollArea>
    </div>
  )
}
