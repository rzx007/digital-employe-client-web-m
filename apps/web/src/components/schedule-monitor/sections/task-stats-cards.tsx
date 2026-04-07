import {
  IconCheck,
  IconClock,
  IconX,
  IconListDetails,
} from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import type { TaskSummary } from "@/types/schedule-monitor"

interface StatCardProps {
  label: string
  value: number
  icon: typeof IconListDetails
  iconBg: string
  iconColor: string
  valueColor: string
}

function StatCard({
  label,
  value,
  icon: Icon,
  iconBg,
  iconColor,
  valueColor,
}: StatCardProps) {
  return (
    <div className="group relative flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50">
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md",
          iconBg
        )}
      >
        <Icon className={cn("size-4", iconColor)} />
      </div>
      <div className="flex flex-col gap-0.5">
        <span
          className={cn(
            "text-base leading-tight font-bold tabular-nums",
            valueColor
          )}
        >
          {value}
        </span>
        <span className="text-[10px] leading-tight text-muted-foreground">
          {label}
        </span>
      </div>
    </div>
  )
}

export function TaskStatsCards({ summary }: { summary: TaskSummary }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <StatCard
        label="计划任务"
        value={summary.total}
        icon={IconListDetails}
        iconBg="bg-muted"
        iconColor="text-foreground"
        valueColor="text-foreground"
      />
      <StatCard
        label="已完成"
        value={summary.completed}
        icon={IconCheck}
        iconBg="bg-green-100 dark:bg-green-900/40"
        iconColor="text-green-600 dark:text-green-400"
        valueColor="text-green-600 dark:text-green-400"
      />
      <StatCard
        label="失败"
        value={summary.failed}
        icon={IconX}
        iconBg="bg-red-100 dark:bg-red-900/40"
        iconColor="text-red-600 dark:text-red-400"
        valueColor="text-red-600 dark:text-red-400"
      />
      <StatCard
        label="待执行"
        value={summary.pending}
        icon={IconClock}
        iconBg="bg-amber-100 dark:bg-amber-900/40"
        iconColor="text-amber-600 dark:text-amber-400"
        valueColor="text-amber-600 dark:text-amber-400"
      />
    </div>
  )
}
