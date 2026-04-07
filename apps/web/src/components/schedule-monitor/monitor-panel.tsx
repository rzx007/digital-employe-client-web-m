import { useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import { cn } from "@workspace/ui/lib/utils"
import { ScrollArea } from "@workspace/ui/components/scroll-area"

import { useChatStore } from "@/stores/chat-store"
import { useMonitorStore } from "@/stores/monitor-store"
import {
  useAnomalies,
  useMonthlyScheduleOverview,
  useTaskSummary,
  useTodayTaskRuns,
} from "@/hooks/use-schedule-monitor-queries"
import { MonitorHeader } from "./monitor-header"
import { EmployeeBasicInfo } from "./sections/employee-basic-info"
import { ScheduleCalendar } from "./sections/schedule-calendar"
import { TaskStatsCards } from "./sections/task-stats-cards"
import { ExecutionDetail } from "./sections/execution-detail"
import { AnomalyMonitor } from "./sections/anomaly-monitor"
import {
  type ChatViewContact,
} from "@/components/chat/chat-view-shared"

export interface MonitorPanelProps {
  isOpen: boolean
  isFullscreen: boolean
  onClose: () => void
  onToggleFullscreen: () => void
  className?: string
}

export function MonitorPanel({
  isOpen,
  isFullscreen,
  onClose,
  onToggleFullscreen,
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
    targetEmployeeId,
    viewYear,
    viewMonth
  )
  const { data: taskRuns = [] } = useTodayTaskRuns(targetEmployeeId)
  const { data: summary } = useTaskSummary(targetEmployeeId)
  const { data: anomalies = [] } = useAnomalies(targetEmployeeId)

  const handleMonthChange = (year: number, month: number) => {
    setViewYear(year)
    setViewMonth(month)
  }

  const employeeContact: ChatViewContact | undefined =
    contact?.type === "employee" ? contact : undefined

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div

          initial={isFullscreen ? { opacity: 0 } : { x: "100%" }}
          animate={isFullscreen ? { opacity: 1 } : { x: 0 }}
          exit={isFullscreen ? { opacity: 0 } : { x: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className={cn(
            "flex h-full flex-col overflow-hidden rounded-lg border bg-background shadow-xl",
            isFullscreen ? "fixed inset-0 z-50 rounded-none" : "w-full",
            className
          )}
        >
          <MonitorHeader
            title={`任务监控 - ${displayName}`}
            onClose={onClose}
            onToggleFullscreen={onToggleFullscreen}
            isFullscreen={isFullscreen}
          />

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

              <ExecutionDetail runs={taskRuns} />

              <AnomalyMonitor anomalies={anomalies} />
            </div>
          </ScrollArea>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
